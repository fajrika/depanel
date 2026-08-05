import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { getSshHistory } from "@/lib/sshmon";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const ssh = await prisma.sshConnection.findUnique({ where: { id } });
  if (!ssh?.teamId) return NextResponse.json({ ok: false, message: "Koneksi SSH tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, ssh.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  const hours = Math.min(Number(new URL(request.url).searchParams.get("hours") ?? 24), 720);
  const data = await getSshHistory(id, hours);
  return NextResponse.json({ ok: true, data });
}
