import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam, membershipOf } from "@/lib/team";
import { createApproval, expireStale, ApprovalError } from "@/lib/approvals";
import { logActivity } from "@/lib/power";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (!(await membershipOf(user.id, team.id))) {
    return NextResponse.json({ ok: false, message: "Anda bukan anggota tim ini" }, { status: 403 });
  }

  await expireStale();

  const rows = await prisma.destructiveApproval.findMany({
    where: { teamId: team.id },
    include: {
      server: { select: { hostname: true } },
      requestedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
    },
  });
  rows.sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return b.requestedAt.getTime() - a.requestedAt.getTime();
  });

  const items = rows.map((r) => ({
    id: r.id,
    action: r.action,
    detail: r.detail,
    status: r.status,
    requestedAt: r.requestedAt,
    resolvedAt: r.resolvedAt,
    server: r.server,
    requestedBy: r.requestedBy,
    approvedBy: r.approvedBy,
  }));
  return NextResponse.json({ ok: true, data: { canManage: team.role === "owner" || team.role === "admin", myId: user.id, items } });
}

const createSchema = z.object({
  serverId: z.string().min(1),
  action: z.enum(["delete", "reinstall"]),
  detail: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role !== "owner" && team.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim yang boleh mengajukan aksi destruktif" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }

  const server = await prisma.server.findUnique({
    where: { id: parsed.data.serverId },
    select: { hostname: true, account: { select: { teamId: true } } },
  });
  if (!server?.account.teamId || server.account.teamId !== team.id) {
    return NextResponse.json({ ok: false, message: "Server tidak ditemukan" }, { status: 404 });
  }

  try {
    const approval = await createApproval({
      teamId: team.id,
      serverId: parsed.data.serverId,
      action: parsed.data.action,
      detail: parsed.data.detail ?? server.hostname,
      requestedById: user.id,
    });
    await logActivity({
      teamId: team.id,
      userId: user.id,
      serverId: parsed.data.serverId,
      action: `approval-${parsed.data.action}`,
      status: "success",
      message: `Ajukan persetujuan ${parsed.data.action} @ ${server.hostname}`,
    });
    return NextResponse.json({ ok: true, data: { id: approval.id } });
  } catch (e) {
    if (e instanceof ApprovalError) return NextResponse.json({ ok: false, message: e.message }, { status: e.status });
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
