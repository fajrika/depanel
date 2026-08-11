import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { resolveApproval, ApprovalError } from "@/lib/approvals";
import { logActivity } from "@/lib/power";

const decisionSchema = z.object({ decision: z.enum(["approved", "rejected"]) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const approval = await prisma.destructiveApproval.findUnique({
    where: { id },
    include: { server: { select: { hostname: true } } },
  });
  if (!approval?.teamId) return NextResponse.json({ ok: false, message: "Permintaan tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, approval.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  }

  try {
    const resolved = await resolveApproval(id, user.id, parsed.data.decision);
    await logActivity({
      teamId: approval.teamId,
      userId: user.id,
      serverId: approval.serverId,
      action: `approval-${parsed.data.decision}`,
      status: "success",
      message: `${parsed.data.decision} persetujuan ${approval.action} @ ${approval.server?.hostname ?? approval.detail ?? ""}`,
    });
    return NextResponse.json({ ok: true, data: { status: resolved.status } });
  } catch (e) {
    if (e instanceof ApprovalError) return NextResponse.json({ ok: false, message: e.message }, { status: e.status });
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}

/** Batalkan (hapus) request yang masih pending — hanya staff. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const approval = await prisma.destructiveApproval.findUnique({
    where: { id },
    select: { id: true, teamId: true, serverId: true, status: true, action: true, detail: true },
  });
  if (!approval?.teamId) return NextResponse.json({ ok: false, message: "Permintaan tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, approval.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }
  if (approval.status !== "pending") {
    return NextResponse.json({ ok: false, message: "Hanya permintaan pending yang bisa dihapus" }, { status: 409 });
  }

  await prisma.destructiveApproval.delete({ where: { id } });
  await logActivity({
    teamId: approval.teamId,
    userId: user.id,
    serverId: approval.serverId,
    action: "approval-cancel",
    message: `Batalkan persetujuan ${approval.action} @ ${approval.detail ?? ""}`,
  });
  return NextResponse.json({ ok: true });
}
