import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/power";
import { loadOwnJob, patchSchema } from "../_shared";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const job = await loadOwnJob(user.id, id);
  if (!job) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  const d = parsed.data;
  if (d.sshId && d.sshId !== job.sshId) {
    const s = await prisma.sshConnection.findUnique({ where: { id: d.sshId }, select: { teamId: true } });
    if (!s || s.teamId !== job.teamId) return NextResponse.json({ ok: false, message: "Koneksi SSH tidak valid" }, { status: 400 });
  }
  const data: Record<string, unknown> = { ...d };
  if ("timeAt" in d) data.timeAt = d.timeAt || null;
  if ("cronExpr" in d) data.cronExpr = d.cronExpr || null;
  if ("serverId" in d) data.serverId = d.serverId || null;
  if ("minDownloadMbps" in d) data.minDownloadMbps = d.minDownloadMbps || null;

  await prisma.speedtestJob.update({ where: { id }, data });
  await logActivity({ teamId: job.teamId, userId: user.id, action: "speedtest-update", message: `Ubah speedtest "${job.name}"` });
  return NextResponse.json({ ok: true, data: { id } });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const job = await loadOwnJob(user.id, id);
  if (!job) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });
  await prisma.speedtestJob.delete({ where: { id } });
  await logActivity({ teamId: job.teamId, userId: user.id, action: "speedtest-delete", message: `Hapus speedtest "${job.name}"` });
  return NextResponse.json({ ok: true });
}
