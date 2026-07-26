import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { membershipOf } from "@/lib/team";

/** GET → activity logs for this server filtered by scheduler source or power actions. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const server = await prisma.server.findUnique({ where: { id }, select: { accountId: true } });
  if (!server) return NextResponse.json({ ok: false, message: "Server tidak ditemukan" }, { status: 404 });

  const account = await prisma.depaAccount.findUnique({ where: { id: server.accountId }, select: { teamId: true } });
  if (!account?.teamId) return NextResponse.json({ ok: false, message: "Tim tidak ditemukan" }, { status: 404 });
  if (!(await membershipOf(user.id, account.teamId))) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);

  const logs = await prisma.activityLog.findMany({
    where: {
      serverId: id,
      OR: [
        { source: "scheduler" },
        { action: { in: ["start", "stop", "restart"] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      source: true,
      status: true,
      message: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json({ ok: true, data: logs });
}
