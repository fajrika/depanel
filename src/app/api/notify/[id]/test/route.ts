import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { sendToChannel } from "@/lib/notify";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const ch = await prisma.notifyChannel.findUnique({ where: { id } });
  if (!ch || !(await staffOf(user.id, ch.teamId))) {
    return NextResponse.json({ ok: false, message: "Tidak diizinkan" }, { status: 403 });
  }
  const err = await sendToChannel(ch, "✅ Depanel — tes notifikasi berhasil.");
  if (err) return NextResponse.json({ ok: false, message: err }, { status: 400 });
  return NextResponse.json({ ok: true });
}
