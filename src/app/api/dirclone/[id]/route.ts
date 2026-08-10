import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
import { logActivity } from "@/lib/power";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  sourceSshId: z.string().min(1).optional(),
  sourcePath: z.string().min(1).refine((p) => p.startsWith("/"), "Path sumber harus absolut (diawali /)").optional(),
  destType: z.enum(["local", "gdrive", "ssh"]).optional(),
  destPath: z.string().optional(),
  destSshId: z.string().optional(),
  destGdriveId: z.string().optional(),
  scheduleType: z.enum(["manual", "daily", "weekly", "monthly", "cron"]).optional(),
  timeAt: z.string().optional(),
  dayOn: z.coerce.number().int().min(0).max(28).nullable().optional(),
  cronExpr: z.string().nullable().optional(),
  timezone: z.string().optional(),
  retention: z.coerce.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const job = await prisma.dirCloneJob.findUnique({ where: { id } });
  if (!job?.teamId) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, job.teamId, "backupDb"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin mengubah job" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Data tidak valid";
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
  const d = parsed.data;

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (k === "sourceSshId" || k === "destSshId" || k === "destGdriveId") {
      const ref = k === "sourceSshId" ? v : null;
      if (ref) {
        const s = await prisma.sshConnection.findUnique({ where: { id: String(v) }, select: { teamId: true } });
        if (!s?.teamId || s.teamId !== job.teamId) return NextResponse.json({ ok: false, message: "Koneksi SSH tidak valid" }, { status: 400 });
      }
    }
    if (k === "destGdriveId" && v) {
      const gd = await prisma.dbDest.findUnique({ where: { id: String(v) }, select: { teamId: true, type: true } });
      if (!gd?.teamId || gd.teamId !== job.teamId || gd.type !== "gdrive") return NextResponse.json({ ok: false, message: "Koneksi Google Drive tidak valid" }, { status: 400 });
    }
    if (k === "destPath") data[k] = v || null;
    else if (k === "cronExpr") data[k] = v || null;
    else if (k === "dayOn") data[k] = v ?? null;
    else data[k] = v;
  }

  const updated = await prisma.dirCloneJob.update({ where: { id }, data });
  await logActivity({ teamId: job.teamId, userId: user.id, action: "dirclone-update", message: `Ubah job clone "${job.name}"` });
  return NextResponse.json({ ok: true, data: { id: updated.id } });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const job = await prisma.dirCloneJob.findUnique({ where: { id } });
  if (!job?.teamId) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, job.teamId, "backupDb"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin menghapus job" }, { status: 403 });
  }

  await prisma.dirCloneJob.delete({ where: { id } });
  await logActivity({ teamId: job.teamId, userId: user.id, action: "dirclone-delete", message: `Hapus job clone "${job.name}"` });
  return NextResponse.json({ ok: true });
}
