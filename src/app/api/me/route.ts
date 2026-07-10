import { NextResponse } from "next/server";
import { getCurrentUser, getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getActiveTeam, getMyTeams } from "@/lib/team";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const session = await getSession();
  const [activeTeam, teams, superAdmin] = await Promise.all([
    getActiveTeam(user),
    getMyTeams(user.id),
    isSuperAdmin(user.id),
  ]);

  // sedang menyamar? sertakan nama akun asal untuk banner
  let impersonatedBy: { id: string; name: string } | null = null;
  if (session?.imp) {
    const orig = await prisma.user.findUnique({ where: { id: session.imp }, select: { id: true, name: true } });
    if (orig) impersonatedBy = orig;
  }

  return NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, uiLayout: user.uiLayout },
    activeTeam,
    teams,
    superAdmin,
    impersonatedBy,
    perms: {
      admin: user.role === "admin",
      owner: activeTeam.role === "owner",
      canViewBilling: activeTeam.canViewBilling,
      canViewLogs: true,
    },
  });
}
