import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import { TEAM_COOKIE } from "@/lib/team";

/** Super admin masuk ke tim mana pun (otomatis jadi admin jika belum anggota). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  if (!(await isSuperAdmin(user.id))) {
    return NextResponse.json({ ok: false, message: "Hanya super admin" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) return NextResponse.json({ ok: false, message: "Tim tidak ditemukan" }, { status: 404 });

  // Upsert membership: super admin masuk sebagai admin
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: id, userId: user.id } },
    create: { teamId: id, userId: user.id, role: "admin", canViewBilling: true, canSchedule: true, canBackup: true },
    update: {},
  });

  // Set sebagai tim aktif
  await prisma.user.update({ where: { id: user.id }, data: { lastTeamId: id } });

  const c = await cookies();
  c.set(TEAM_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ ok: true });
}
