// Periodic alert checks (run by the worker): low team balance and servers in error.
// In-memory dedup keeps a long-running worker from spamming the same alert.
import { prisma } from "./db";
import { clientForAccount } from "./power";
import { notifyTeam } from "./notify";

const RENOTIFY_MS = 6 * 60 * 60 * 1000; // re-alert an ongoing condition at most every 6h
const lastSent = new Map<string, number>();

function due(key: string, now: number): boolean {
  const prev = lastSent.get(key);
  if (prev && now - prev < RENOTIFY_MS) return false;
  lastSent.set(key, now);
  return true;
}

function rupiah(n?: number): string {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
}

export async function runAlertChecks(now: Date = new Date()): Promise<void> {
  const t = now.getTime();

  // ---- low balance per team ----
  const teams = await prisma.team.findMany({
    where: { lowBalanceThreshold: { not: null } },
    include: { accounts: { where: { active: true }, take: 1 } },
  });
  for (const team of teams) {
    const acc = team.accounts[0];
    if (!acc || team.lowBalanceThreshold == null) continue;
    try {
      const client = await clientForAccount(acc.id);
      const summary = (await client.billingSummary()) as { actual_balance?: number };
      const bal = summary?.actual_balance;
      if (typeof bal === "number" && bal < team.lowBalanceThreshold) {
        if (due(`bal:${team.id}`, t)) {
          await notifyTeam(team.id, "balance", `💰 Saldo tim "${team.name}" tinggal ${rupiah(bal)} (ambang ${rupiah(team.lowBalanceThreshold)}).`);
        }
      } else {
        lastSent.delete(`bal:${team.id}`); // recovered → allow future alert
      }
    } catch {
      /* abaikan error billing sesaat */
    }
  }

  // ---- servers in error state ----
  const errored = await prisma.server.findMany({
    where: { status: "error" },
    include: { account: { select: { teamId: true } } },
  });
  const stillError = new Set(errored.map((s) => `err:${s.id}`));
  for (const s of errored) {
    if (due(`err:${s.id}`, t)) {
      await notifyTeam(s.account.teamId, "error", `🚨 Server "${s.hostname}" berstatus ERROR di depa.`);
    }
  }
  // clear dedup for servers no longer in error
  for (const key of [...lastSent.keys()]) {
    if (key.startsWith("err:") && !stillError.has(key)) lastSent.delete(key);
  }
}
