import { NextResponse } from "next/server";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member") return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });

  const jobs = await prisma.dbBackupJob.findMany({
    where: { connection: { teamId: team.id } },
    orderBy: { createdAt: "asc" },
    include: {
      connection: { select: { id: true, name: true, host: true } },
      dest: { select: { id: true, type: true, name: true } },
    },
  });
  const data = jobs.map((j) => ({
    id: j.id,
    name: j.name,
    connection: j.connection,
    databases: JSON.parse(j.databases) as string[],
    scheduleType: j.scheduleType,
    timeAt: j.timeAt,
    dayOn: j.dayOn,
    cronExpr: j.cronExpr,
    timezone: j.timezone,
    destType: j.destType,
    destId: j.destId,
    destPath: j.destPath,
    dest: j.dest,
    retention: j.retention,
    compression: j.compression,
    enabled: j.enabled,
    lastRunAt: j.lastRunAt,
    lastStatus: j.lastStatus,
  }));
  return NextResponse.json({ ok: true, data });
}

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const createSchema = z
  .object({
    name: z.string().min(1),
    connectionId: z.string().min(1),
    databases: z.array(z.string().min(1)).min(1, "Pilih minimal satu database"),
    scheduleType: z.enum(["hourly", "daily", "weekly", "monthly", "cron"]),
    timeAt: z.string().regex(timeRe).optional(),
    dayOn: z.number().int().min(0).max(28).optional(),
    cronExpr: z.string().optional(),
    timezone: z.string().default("Asia/Jakarta"),
    destType: z.enum(["local", "ftp", "s3", "gdrive"]),
    destId: z.string().optional().nullable(),
    destPath: z.string().optional().nullable(),
    retention: z.number().int().min(0).max(1000).default(0), // 0 = keep all, N = keep last N
    compression: z.enum(["none", "gzip", "brotli", "xz", "xz_extreme"]).default("brotli"),
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
    } else if (v.scheduleType !== "hourly" && !v.timeAt) {
      ctx.addIssue({ code: "custom", message: "Jam backup wajib diisi" });
    }
    if (v.scheduleType === "weekly" && v.dayOn === undefined)
      ctx.addIssue({ code: "custom", message: "Pilih hari untuk backup mingguan" });
    if (v.scheduleType === "monthly" && (v.dayOn === undefined || v.dayOn < 1))
      ctx.addIssue({ code: "custom", message: "Pilih tanggal (1-28) untuk backup bulanan" });
    if (v.destType === "local" && !v.destPath)
      ctx.addIssue({ code: "custom", message: "Path folder tujuan wajib diisi" });
    if (v.destType !== "local" && !v.destId)
      ctx.addIssue({ code: "custom", message: "Pilih koneksi tujuan backup" });
  });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member") return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const v = parsed.data;

  const conn = await prisma.dbConnection.findUnique({ where: { id: v.connectionId } });
  if (!conn || conn.teamId !== team.id) {
    return NextResponse.json({ ok: false, message: "Koneksi tidak ditemukan di tim ini" }, { status: 404 });
  }

  if (v.destId) {
    const dest = await prisma.dbDest.findUnique({ where: { id: v.destId } });
    if (!dest || dest.teamId !== team.id) {
      return NextResponse.json({ ok: false, message: "Koneksi tujuan tidak ditemukan di tim ini" }, { status: 404 });
    }
  }

  const job = await prisma.dbBackupJob.create({
    data: {
      name: v.name,
      connectionId: v.connectionId,
      databases: JSON.stringify(v.databases),
      scheduleType: v.scheduleType,
      timeAt: v.timeAt ?? null,
      dayOn: v.dayOn ?? null,
      cronExpr: v.cronExpr ?? null,
      timezone: v.timezone,
      destType: v.destType,
      destId: v.destId ?? null,
      destPath: v.destPath ?? null,
      retention: v.retention,
      compression: v.compression,
    },
  });
  return NextResponse.json({ ok: true, data: { id: job.id } });
}
