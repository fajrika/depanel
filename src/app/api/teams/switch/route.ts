import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { membershipOf, TEAM_COOKIE } from "@/lib/team";

const schema = z.object({ teamId: z.string().min(1) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });

  const m = await membershipOf(user.id, parsed.data.teamId);
  if (!m) return NextResponse.json({ ok: false, message: "Anda bukan anggota tim itu" }, { status: 403 });

  // simpan sebagai tim terakhir — dipulihkan otomatis saat login berikutnya (device mana pun)
  await prisma.user.update({ where: { id: user.id }, data: { lastTeamId: parsed.data.teamId } });

  const c = await cookies();
  c.set(TEAM_COOKIE, parsed.data.teamId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return NextResponse.json({ ok: true });
}
