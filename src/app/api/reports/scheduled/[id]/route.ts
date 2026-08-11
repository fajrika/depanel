import { NextResponse } from "next/server";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
import { logActivity } from "@/lib/power";

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    type: z.enum(["cost", "activity", "backup"]).optional(),
    scheduleType: z.enum(["daily", "weekly", "monthly", "cron"]).optional(),
    timeAt: z.string().regex(timeRe, "Format jam HH:MM").optional().nullable(),
    dayOn: z.coerce.number().int().min(0).max(31).optional().nullable(),
    cronExpr: z.string().optional().nullable(),
    timezone: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    // Validasi hanya saat jadwal ikut dikirim (toggle `enabled` tidak tersentuh).
    if (v.scheduleType === "cron") {
      if (!v.cronExpr) ctx.addIssue({ code: "custom", message: "Cron expression wajib diisi" });
      else {
        try {
          CronExpressionParser.parse(v.cronExpr);
        } catch {
          ctx.addIssue({ code: "custom", message: "Cron expression tidak valid" });
        }
      }
    } else if (v.scheduleType) {
      if (v.timeAt === undefined || v.timeAt === null)
        ctx.addIssue({ code: "custom", message: "Jam laporan wajib diisi" });
      if (v.scheduleType === "weekly" && (v.dayOn === undefined || v.dayOn === null || v.dayOn > 6))
        ctx.addIssue({ code: "custom", message: "Pilih hari untuk laporan mingguan" });
      if (v.scheduleType === "monthly" && (v.dayOn === undefined || v.dayOn === null || v.dayOn < 1 || v.dayOn > 28))
        ctx.addIssue({ code: "custom", message: "Pilih tanggal (1-28) untuk laporan bulanan" });
    }
  });

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const rep = await prisma.scheduledReport.findUnique({ where: { id } });
  if (!rep?.teamId) return NextResponse.json({ ok: false, message: "Laporan terjadwal tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, rep.teamId, "reports"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin mengubah laporan terjadwal" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;

  // Bila jadwal berubah, pastikan nilai lama/baru tetap konsisten.
  const st = d.scheduleType ?? rep.scheduleType;
  const dayOn = d.dayOn !== undefined ? d.dayOn : rep.dayOn;
  if (st === "weekly" && (dayOn === null || dayOn === undefined || dayOn > 6)) {
    return NextResponse.json({ ok: false, message: "Pilih hari untuk laporan mingguan" }, { status: 400 });
  }
  if (st === "monthly" && (dayOn === null || dayOn === undefined || dayOn < 1 || dayOn > 28)) {
    return NextResponse.json({ ok: false, message: "Pilih tanggal (1-28) untuk laporan bulanan" }, { status: 400 });
  }

  await prisma.scheduledReport.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.type !== undefined ? { type: d.type } : {}),
      ...(d.scheduleType !== undefined ? { scheduleType: d.scheduleType } : {}),
      ...(d.timeAt !== undefined ? { timeAt: d.timeAt || null } : {}),
      ...(d.dayOn !== undefined ? { dayOn: d.dayOn ?? null } : {}),
      ...(d.cronExpr !== undefined ? { cronExpr: d.cronExpr || null } : {}),
      ...(d.timezone !== undefined ? { timezone: d.timezone } : {}),
      ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
    },
  });
  await logActivity({ teamId: rep.teamId, userId: user.id, action: "report-update", message: `Ubah laporan terjadwal "${rep.name}"` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const rep = await prisma.scheduledReport.findUnique({ where: { id } });
  if (!rep?.teamId) return NextResponse.json({ ok: false, message: "Laporan terjadwal tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, rep.teamId, "reports"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin menghapus laporan terjadwal" }, { status: 403 });
  }

  await prisma.scheduledReport.delete({ where: { id } });
  await logActivity({ teamId: rep.teamId, userId: user.id, action: "report-delete", message: `Hapus laporan terjadwal "${rep.name}"` });
  return NextResponse.json({ ok: true });
}
