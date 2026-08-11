import { NextResponse } from "next/server";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam, canUseFeature } from "@/lib/team";
import { logActivity } from "@/lib/power";

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const createSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(["cost", "activity", "backup"]),
    scheduleType: z.enum(["daily", "weekly", "monthly", "cron"]),
    timeAt: z.string().regex(timeRe, "Format jam HH:MM").optional(),
    dayOn: z.coerce.number().int().min(0).max(31).optional(),
    cronExpr: z.string().optional(),
    timezone: z.string().default("Asia/Jakarta"),
  })
  .superRefine((v, ctx) => {
    if (v.scheduleType === "cron") {
      if (!v.cronExpr) ctx.addIssue({ code: "custom", message: "Cron expression wajib diisi" });
      else {
        try {
          CronExpressionParser.parse(v.cronExpr);
        } catch {
          ctx.addIssue({ code: "custom", message: "Cron expression tidak valid" });
        }
      }
    } else if (!v.timeAt) {
      ctx.addIssue({ code: "custom", message: "Jam laporan wajib diisi" });
    }
    if (v.scheduleType === "weekly" && (v.dayOn === undefined || v.dayOn > 6))
      ctx.addIssue({ code: "custom", message: "Pilih hari untuk laporan mingguan" });
    if (v.scheduleType === "monthly" && (v.dayOn === undefined || v.dayOn < 1 || v.dayOn > 28))
      ctx.addIssue({ code: "custom", message: "Pilih tanggal (1-28) untuk laporan bulanan" });
  });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (!(await canUseFeature(user.id, team.id, "reports"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuka Laporan" }, { status: 403 });
  }

  const reports = await prisma.scheduledReport.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ ok: true, data: reports });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (!(await canUseFeature(user.id, team.id, "reports"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuat laporan terjadwal" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;

  const report = await prisma.scheduledReport.create({
    data: {
      teamId: team.id,
      name: d.name,
      type: d.type,
      scheduleType: d.scheduleType,
      timeAt: d.timeAt || null,
      dayOn: d.dayOn ?? null,
      cronExpr: d.cronExpr || null,
      timezone: d.timezone,
    },
  });
  await logActivity({ teamId: team.id, userId: user.id, action: "report-create", message: `Buat laporan terjadwal "${d.name}"` });
  return NextResponse.json({ ok: true, data: { id: report.id } });
}
