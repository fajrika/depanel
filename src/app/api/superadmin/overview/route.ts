import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";

/** Semua user + semua tim di aplikasi — khusus super admin. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  if (!(await isSuperAdmin(user.id))) {
    return NextResponse.json({ ok: false, message: "Hanya super admin" }, { status: 403 });
  }

  const [users, teams] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
        teams: { select: { role: true, team: { select: { id: true, name: true, isPersonal: true } } } },
      },
    }),
    prisma.team.findMany({
      orderBy: [{ isPersonal: "desc" }, { createdAt: "asc" }],
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
        _count: { select: { accounts: true } },
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        active: u.active,
        teams: u.teams.map((t) => ({ id: t.team.id, name: t.team.name, role: t.role, isPersonal: t.team.isPersonal })),
      })),
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        isPersonal: t.isPersonal,
        accountCount: t._count.accounts,
        members: t.members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email, role: m.role })),
      })),
    },
  });
}
