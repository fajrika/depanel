import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/power";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  await prisma.user.update({ where: { id: user.id }, data: { sessionRevokedAt: new Date() } });
  await logActivity({ userId: user.id, action: "logout-all", message: "Keluar dari semua perangkat" });
  return NextResponse.json({ ok: true });
}
