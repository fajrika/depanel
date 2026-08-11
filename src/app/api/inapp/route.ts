import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/** Notifikasi in-app milik user (pribadi + semua anggota tim-nya). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const memberships = await prisma.teamMember.findMany({ where: { userId: user.id }, select: { teamId: true } });
  const teamIds = memberships.map((m) => m.teamId);

  const [notifs, unreadCount] = await Promise.all([
    prisma.inAppNotification.findMany({
      where: {
        OR: [
          { userId: user.id },
          { userId: null, teamId: { in: teamIds } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.inAppNotification.count({
      where: {
        read: false,
        OR: [{ userId: user.id }, { userId: null, teamId: { in: teamIds } }],
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    data: notifs.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    unreadCount,
  });
}

/** Tandai semua notifikasi user sebagai dibaca. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const memberships = await prisma.teamMember.findMany({ where: { userId: user.id }, select: { teamId: true } });
  await prisma.inAppNotification.updateMany({
    where: {
      read: false,
      OR: [{ userId: user.id }, { userId: null, teamId: { in: memberships.map((m) => m.teamId) } }],
    },
    data: { read: true },
  });
  return NextResponse.json({ ok: true });
}
