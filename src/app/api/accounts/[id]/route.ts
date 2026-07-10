import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const account = await prisma.depaAccount.findUnique({ where: { id } });
  if (!account?.teamId) return NextResponse.json({ ok: false, message: "Akun tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, account.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  await prisma.depaAccount.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
