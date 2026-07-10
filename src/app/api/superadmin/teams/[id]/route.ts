import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/power";

/** Super admin menghapus tim mana pun (kecuali tim pribadi). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  if (!(await isSuperAdmin(user.id))) {
    return NextResponse.json({ ok: false, message: "Hanya super admin" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) return NextResponse.json({ ok: false, message: "Tim tidak ditemukan" }, { status: 404 });
  if (team.isPersonal) {
    return NextResponse.json({ ok: false, message: "Tim pribadi tidak bisa dihapus" }, { status: 400 });
  }

  await prisma.team.delete({ where: { id } });
  await logActivity({ userId: user.id, action: "team-delete", message: `(super admin) Hapus tim ${team.name}` });
  return NextResponse.json({ ok: true });
}
