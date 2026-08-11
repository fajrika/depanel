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
  scheduleType: z.enum(["manual", "daily", "weekly", "monthly", "cron"]).optional(),
  timeAt: z.string().optional(),
  dayOn: z.coerce.number().int().min(0).max(28).nullable().optional(),
  cronExpr: z.string().nullable().optional(),
  timezone: z.string().optional(),
  timeoutSec: z.coerce.number().int().min(1).max(3600).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const job = await prisma.sshCommandJob.findUnique({ where: { id } });
  if (!job?.teamId) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, job.teamId, "ssh"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin mengubah job" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (k === "sshId") {
      const s = await prisma.sshConnection.findUnique({ where: { id: String(v) }, select: { teamId: true } });
      if (!s?.teamId || s.teamId !== job.teamId) return NextResponse.json({ ok: false, message: "Koneksi SSH tidak valid" }, { status: 400 });
      data[k] = v;
    } else if (k === "timeAt" || k === "cronExpr") {
      data[k] = v || null;
    } else if (k === "dayOn") {
      data[k] = v ?? null;
    } else {
      data[k] = v;
    }
  }

  const updated = await prisma.sshCommandJob.update({ where: { id }, data });
  await logActivity({ teamId: job.teamId, userId: user.id, action: "sshcmd-update", message: `Ubah job SSH command "${job.name}"` });
  return NextResponse.json({ ok: true, data: { id: updated.id } });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const job = await prisma.sshCommandJob.findUnique({ where: { id } });
  if (!job?.teamId) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, job.teamId, "ssh"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin menghapus job" }, { status: 403 });
  }

  await prisma.sshCommandJob.delete({ where: { id } });
  await logActivity({ teamId: job.teamId, userId: user.id, action: "sshcmd-delete", message: `Hapus job SSH command "${job.name}"` });
  return NextResponse.json({ ok: true });
}
