import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function PATCH(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const n = await prisma.inAppNotification.findUnique({ where: { id } });
  if (!n) return NextResponse.json({ ok: false, message: "Notifikasi tidak ditemukan" }, { status: 404 });
  // hanya pemilik atau anggota tim yang boleh menandai
  const member = n.userId
    ? n.userId === user.id
    : !!(await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: n.teamId ?? "", userId: user.id } } }));
  if (!member) return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 });

  await prisma.inAppNotification.update({ where: { id }, data: { read: true } });
  return NextResponse.json({ ok: true });
}
