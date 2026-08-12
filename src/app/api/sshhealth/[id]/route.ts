import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
import { logActivity } from "@/lib/power";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  sshId: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  intervalMin: z.coerce.number().int().min(1).max(1440).optional(),
  timeoutSec: z.coerce.number().int().min(1).max(300).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const hc = await prisma.sshHealthCheck.findUnique({ where: { id } });
  if (!hc?.teamId) return NextResponse.json({ ok: false, message: "App health tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, hc.teamId, "ssh"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin mengubah app health" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;

  if (d.sshId) {
    const ssh = await prisma.sshConnection.findUnique({ where: { id: d.sshId }, select: { teamId: true } });
    if (!ssh?.teamId || ssh.teamId !== hc.teamId) {
      return NextResponse.json({ ok: false, message: "Koneksi SSH tidak ditemukan" }, { status: 400 });
    }
  }

  await prisma.sshHealthCheck.update({ where: { id }, data: d });
  await logActivity({ teamId: hc.teamId, userId: user.id, action: "sshhealth-update", message: `Ubah app health "${hc.name}"` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const hc = await prisma.sshHealthCheck.findUnique({ where: { id } });
  if (!hc?.teamId) return NextResponse.json({ ok: false, message: "App health tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, hc.teamId, "ssh"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin menghapus app health" }, { status: 403 });
  }

  await prisma.sshHealthCheck.delete({ where: { id } });
  await logActivity({ teamId: hc.teamId, userId: user.id, action: "sshhealth-delete", message: `Hapus app health "${hc.name}"` });
  return NextResponse.json({ ok: true });
}
