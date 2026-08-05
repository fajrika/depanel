import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
import { sampleSshConnection } from "@/lib/sshmon";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const ssh = await prisma.sshConnection.findUnique({ where: { id } });
  if (!ssh?.teamId) return NextResponse.json({ ok: false, message: "Koneksi SSH tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, ssh.teamId, "ssh"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuka SSH Koneksi" }, { status: 403 });
  }

  const res = await sampleSshConnection(id);
  if (!res.ok) {
    return NextResponse.json({ ok: false, message: res.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, data: res.sample });
}
