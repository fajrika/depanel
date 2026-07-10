// Shared power/reconcile service — imported by both web API routes and the worker.
// IMPORTANT: no next/headers import here, so it runs fine in a plain Node (worker) context.
import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import { depaClient } from "./depa";
import { desiredState, type Action } from "./schedule";

export type PowerAction = "start" | "stop" | "restart";

export async function logActivity(entry: {
  teamId?: string | null;
  userId?: string | null;
  serverId?: string | null;
  action: string;
  source?: "web" | "scheduler";
  status?: "success" | "failed";
  message?: string;
}) {
  await prisma.activityLog.create({
    data: {
      teamId: entry.teamId ?? null,
      userId: entry.userId ?? null,
      serverId: entry.serverId ?? null,
      action: entry.action,
      source: entry.source ?? "web",
      status: entry.status ?? "success",
      message: entry.message ?? null,
    },
  });
}

/** Decrypt an account's API key and return a depa client. */
export async function clientForAccount(accountId: string) {
  const account = await prisma.depaAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Akun tidak ditemukan");
  return depaClient(decryptSecret(account.apiKeyEnc));
}

/** Sync all instances of an account from depa into our DB (upsert). */
export async function syncAccount(accountId: string): Promise<number> {
  const account = await prisma.depaAccount.findUnique({ where: { id: accountId }, select: { teamId: true } });
  const teamId = account?.teamId ?? null;
  const client = await clientForAccount(accountId);
  const instances = await client.listInstances();
  let synced = 0;
  for (const inst of instances) {
    try {
      await prisma.server.upsert({
        where: { accountId_uuid: { accountId, uuid: inst.uuid } },
        create: {
          accountId,
          uuid: inst.uuid,
          hostname: inst.hostname,
          status: inst.status,
          location: inst.location,
          tier: inst.tier,
          ipAddress: inst.ip,
          cpu: inst.cpu,
          memoryMb: inst.memoryMb,
          storageGb: inst.storageGb,
          raw: JSON.stringify(inst.raw),
          lastSyncedAt: new Date(),
        },
        update: {
          hostname: inst.hostname,
          status: inst.status,
          location: inst.location,
          tier: inst.tier,
          ipAddress: inst.ip,
          cpu: inst.cpu,
          memoryMb: inst.memoryMb,
          storageGb: inst.storageGb,
          raw: JSON.stringify(inst.raw),
          lastSyncedAt: new Date(),
        },
      });
      synced++;
    } catch (e) {
      await logActivity({
        teamId,
        action: "sync",
        source: "scheduler",
        status: "failed",
        message: `Lewati ${inst.hostname || inst.uuid}: ${(e as Error).message}`,
      });
    }
  }

  // Drop servers that no longer exist on depa (e.g. removed/recreated by the user there).
  // Skip pruning on an empty result — that's more likely a transient/empty API response
  // than "the user really deleted every server," and we never want a hiccup to wipe everything.
  if (instances.length > 0) {
    const liveUuids = instances.map((i) => i.uuid);
    const removed = await prisma.server.deleteMany({
      where: { accountId, uuid: { notIn: liveUuids } },
    });
    if (removed.count > 0) {
      await logActivity({
        teamId,
        action: "sync",
        source: "web",
        message: `${removed.count} server dihapus dari panel (sudah tidak ada di depa)`,
      });
    }
  }

  await prisma.depaAccount.update({ where: { id: accountId }, data: { lastSyncedAt: new Date() } });
  return synced;
}

const DETAIL_TTL_MS = 10 * 60 * 1000; // detail cache: 10 minutes

/**
 * Instance detail with DB caching to stay well under depa's rate limit
 * (60 req/min). Pass force=true to bypass the cache.
 */
export async function getServerDetail(serverId: string, force = false): Promise<Record<string, unknown>> {
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server) throw new Error("Server tidak ditemukan");

  const fresh =
    !force &&
    server.detailJson &&
    server.detailSyncedAt &&
    Date.now() - server.detailSyncedAt.getTime() < DETAIL_TTL_MS;
  if (fresh) {
    try {
      return JSON.parse(server.detailJson!);
    } catch {
      /* cache rusak — ambil ulang */
    }
  }

  const client = await clientForAccount(server.accountId);
  const detail = await client.instanceDetail(server.uuid);
  await prisma.server.update({
    where: { id: serverId },
    data: { detailJson: JSON.stringify(detail), detailSyncedAt: new Date() },
  });
  return detail;
}

/** Perform a power action on a server. Enforces safety (no auto-stop of production). */
export async function powerServer(
  serverId: string,
  action: PowerAction,
  opts: { source: "web" | "scheduler"; userId?: string | null }
): Promise<{ ok: boolean; message: string }> {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: { account: { select: { teamId: true } } },
  });
  if (!server) return { ok: false, message: "Server tidak ditemukan" };
  const teamId = server.account.teamId;

  // Safety: production may never be stopped/restarted by the scheduler.
  if (opts.source === "scheduler" && server.isProduction && action !== "start") {
    return { ok: false, message: "Dilewati: server production tidak boleh dimatikan otomatis" };
  }
  // Safety: only managed servers can be controlled at all.
  if (!server.managed) {
    return { ok: false, message: "Server tidak ditandai 'managed'" };
  }

  const client = await clientForAccount(server.accountId);
  try {
    if (action === "start") await client.start(server.uuid);
    else if (action === "stop") await client.stop(server.uuid);
    else await client.restart(server.uuid);

    const newStatus = action === "stop" ? "stopped" : "running";
    await prisma.server.update({ where: { id: serverId }, data: { status: newStatus } });
    await logActivity({
      teamId,
      userId: opts.userId,
      serverId,
      action,
      source: opts.source,
      status: "success",
      message: `${action} ${server.hostname}`,
    });
    return { ok: true, message: `${action} berhasil` };
  } catch (e) {
    const message = (e as Error).message;
    await logActivity({ teamId, userId: opts.userId, serverId, action, source: opts.source, status: "failed", message });
    return { ok: false, message };
  }
}

/**
 * Reconcile all managed servers with an enabled schedule:
 * refresh live status, compute desired state, and act on drift.
 * Returns a summary of actions taken.
 */
export async function reconcileAll(now: Date = new Date()) {
  const actions: { hostname: string; action: PowerAction; ok: boolean; message: string }[] = [];

  // Accounts that have at least one managed, scheduled, enabled server.
  const managed = await prisma.server.findMany({
    where: { managed: true, schedule: { is: { enabled: true } } },
    include: { schedule: { include: { actions: true } } },
  });
  const accountIds = [...new Set(managed.map((s) => s.accountId))];

  // Refresh live status per account (best-effort).
  for (const accountId of accountIds) {
    try {
      await syncAccount(accountId);
    } catch (e) {
      await logActivity({ action: "sync", source: "scheduler", status: "failed", message: (e as Error).message });
    }
  }

  // Reload with fresh status.
  const servers = await prisma.server.findMany({
    where: { managed: true, schedule: { is: { enabled: true } } },
    include: { schedule: { include: { actions: true } } },
  });

  for (const s of servers) {
    if (!s.schedule) continue;
    const desired = desiredState(
      {
        enabled: s.schedule.enabled,
        timezone: s.schedule.timezone,
        actions: s.schedule.actions as unknown as Action[],
      },
      now
    );
    if (!desired) continue;

    const actual = s.status;
    if (desired === "running" && actual !== "running") {
      const r = await powerServer(s.id, "start", { source: "scheduler" });
      actions.push({ hostname: s.hostname, action: "start", ok: r.ok, message: r.message });
    } else if (desired === "stopped" && actual === "running") {
      if (s.isProduction) continue; // never auto-stop production
      const r = await powerServer(s.id, "stop", { source: "scheduler" });
      actions.push({ hostname: s.hostname, action: "stop", ok: r.ok, message: r.message });
    }
  }

  return actions;
}
