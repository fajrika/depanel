// Two-person rule: request & resolve destructive actions (hapus instance / reinstall).
// Worker-safe: tidak import next/headers / server-only modules.
import { prisma } from "./db";
import { clientForAccount } from "./power";

export type ApprovalDecision = "approved" | "rejected";

export const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

export class ApprovalError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Buat permintaan persetujuan; 409 bila masih ada pending untuk server+aksi yang sama. */
export async function createApproval(opts: {
  teamId: string;
  serverId?: string | null;
  action: "delete" | "reinstall";
  detail?: string | null;
  requestedById: string;
}) {
  const existing = await prisma.destructiveApproval.findFirst({
    where: {
      teamId: opts.teamId,
      serverId: opts.serverId ?? null,
      action: opts.action,
      status: "pending",
    },
    select: { id: true },
  });
  if (existing) {
    throw new ApprovalError("Masih ada permintaan persetujuan yang menunggu untuk aksi ini", 409);
  }
  return prisma.destructiveApproval.create({
    data: {
      teamId: opts.teamId,
      serverId: opts.serverId ?? null,
      action: opts.action,
      detail: opts.detail ?? null,
      requestedById: opts.requestedById,
    },
  });
}

/**
 * Putuskan permintaan (approve/reject).
 * - Approver tidak boleh sama dengan requester.
 * - Approve: eksekusi aksi dulu via depa client; sukses → status "approved";
 *   gagal → status tetap "pending" dan error dilempar ke pemanggil.
 */
export async function resolveApproval(approvalId: string, approverId: string, decision: ApprovalDecision) {
  const approval = await prisma.destructiveApproval.findUnique({ where: { id: approvalId } });
  if (!approval) throw new ApprovalError("Permintaan persetujuan tidak ditemukan", 404);
  if (approval.status !== "pending") throw new ApprovalError("Permintaan ini sudah diputuskan", 409);
  if (approval.requestedById === approverId) {
    throw new ApprovalError("Anda tidak bisa memutuskan permintaan Anda sendiri", 403);
  }

  if (decision === "rejected") {
    return prisma.destructiveApproval.update({
      where: { id: approvalId },
      data: { status: "rejected", approvedById: approverId, resolvedAt: new Date() },
    });
  }

  // approved — eksekusi aksi dulu, baru tandai approved.
  if (!approval.serverId) throw new ApprovalError("Server tidak ditemukan", 404);
  const server = await prisma.server.findUnique({ where: { id: approval.serverId } });
  if (!server) throw new ApprovalError("Server tidak ditemukan", 404);

  const client = await clientForAccount(server.accountId);
  try {
    if (approval.action === "delete") {
      await client.instanceDelete(server.uuid);
    } else if (approval.action === "reinstall") {
      let detail: { template_id?: number; username?: string; password?: string } = {};
      try {
        detail = JSON.parse(approval.detail ?? "{}") as typeof detail;
      } catch {
        /* detail bukan JSON — pakai kosong */
      }
      await client.reinstall(server.uuid, {
        template_id: detail.template_id ?? 0,
        username: detail.username ?? "root",
        password: detail.password ?? "",
      });
    }
  } catch (e) {
    throw new ApprovalError(`Eksekusi aksi gagal, permintaan tetap menunggu: ${(e as Error).message}`, 400);
  }

  if (approval.action === "delete") {
    await prisma.server.delete({ where: { id: server.id } }).catch(() => null);
  }
  return prisma.destructiveApproval.update({
    where: { id: approvalId },
    data: { status: "approved", approvedById: approverId, resolvedAt: new Date() },
  });
}

/** Tandai pending yang lebih dari 7 hari menjadi "expired". Dipanggil saat list. */
export async function expireStale() {
  const stale = await prisma.destructiveApproval.findMany({
    where: { status: "pending", requestedAt: { lt: new Date(Date.now() - APPROVAL_TTL_MS) } },
    select: { id: true },
  });
  if (stale.length === 0) return 0;
  const res = await prisma.destructiveApproval.updateMany({
    where: { id: { in: stale.map((s) => s.id) } },
    data: { status: "expired", resolvedAt: new Date() },
  });
  return res.count;
}
