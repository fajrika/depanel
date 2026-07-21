import { NextResponse } from "next/server";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { encryptSecret } from "@/lib/crypto";

async function guardJob(userId: string, jobId: string) {
  const job = await prisma.dbBackupJob.findUnique({
    where: { id: jobId },
    include: { connection: { select: { teamId: true } } },
  });
  if (!job?.connection.teamId) return null;
  if (!(await staffOf(userId, job.connection.teamId))) return null;
  return job;
}

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().min(1).optional(),
    connectionId: z.string().min(1).optional(),
    databases: z.array(z.string().min(1)).min(1, "Pilih minimal satu database").optional(),
    scheduleType: z.enum(["daily", "weekly", "monthly", "cron"]).optional(),
    timeAt: z.string().regex(timeRe).optional().nullable(),
    dayOn: z.number().int().min(0).max(28).optional().nullable(),
    cronExpr: z.string().optional().nullable(),
    timezone: z.string().optional(),
    destType: z.enum(["local", "ftp", "s3"]).optional(),
    dest: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    retention: z.number().int().min(0).max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.scheduleType === "cron") {
      if (v.cronExpr === undefined || v.cronExpr === null) ctx.addIssue({ code: "custom", message: "Cron expression wajib diisi" });
      else if (v.cronExpr) {
        try { CronExpressionParser.parse(v.cronExpr); } catch { ctx.addIssue({ code: "custom", message: "Cron expression tidak valid" }); }
      }
    } else if (v.scheduleType && !v.timeAt) {
      ctx.addIssue({ code: "custom", message: "Jam backup wajib diisi" });
    }
    if (v.scheduleType === "weekly" && v.dayOn === undefined) ctx.addIssue({ code: "custom", message: "Pilih hari untuk backup mingguan" });
    if (v.scheduleType === "monthly" && (v.dayOn === undefined || v.dayOn === null || (typeof v.dayOn === "number" && v.dayOn < 1)))
      ctx.addIssue({ code: "custom", message: "Pilih tanggal (1-28) untuk backup bulanan" });
    if (v.destType === "local" && v.dest && !v.dest.path) ctx.addIssue({ code: "custom", message: "Path tujuan wajib diisi" });
    if (v.destType === "ftp" && v.dest && (!v.dest.host || !v.dest.username)) ctx.addIssue({ code: "custom", message: "Host & username FTP wajib diisi" });
    if (v.destType === "s3" && v.dest && (!v.dest.bucket || !v.dest.accessKeyId)) ctx.addIssue({ code: "custom", message: "Bucket & access key S3 wajib diisi" });
  });

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const job = await guardJob(user.id, id);
  if (!job) return NextResponse.json({ ok: false, message: "Job tidak ditemukan / bukan wewenang Anda" }, { status: 403 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });

  const v = parsed.data;
  const data: Record<string, unknown> = {};

  if (v.enabled !== undefined) data.enabled = v.enabled;
  if (v.name !== undefined) data.name = v.name;
  if (v.timezone !== undefined) data.timezone = v.timezone;
  if (v.retention !== undefined) data.retention = v.retention;

  if (v.connectionId !== undefined) {
    const conn = await prisma.dbConnection.findUnique({ where: { id: v.connectionId } });
    if (!conn || conn.teamId !== job.connection.teamId) {
      return NextResponse.json({ ok: false, message: "Koneksi tidak ditemukan di tim ini" }, { status: 404 });
    }
    data.connectionId = v.connectionId;
  }

  if (v.databases !== undefined) data.databases = JSON.stringify(v.databases);
  if (v.scheduleType !== undefined) data.scheduleType = v.scheduleType;
  if (v.timeAt !== undefined) data.timeAt = v.timeAt;
  if (v.dayOn !== undefined) data.dayOn = v.dayOn;
  if (v.cronExpr !== undefined) data.cronExpr = v.cronExpr;
  if (v.destType !== undefined) data.destType = v.destType;

  if (v.dest !== undefined) {
    const dest: Record<string, unknown> = { ...v.dest };
    if (typeof dest.password === "string" && dest.password) {
      dest.passwordEnc = encryptSecret(dest.password);
      delete dest.password;
    }
    if (typeof dest.secretKey === "string" && dest.secretKey) {
      dest.secretKeyEnc = encryptSecret(dest.secretKey);
      delete dest.secretKey;
    }
    if (typeof dest.serviceAccountKey === "string" && dest.serviceAccountKey) {
      dest.serviceAccountKeyEnc = encryptSecret(dest.serviceAccountKey);
      delete dest.serviceAccountKey;
    }
    data.destConfig = JSON.stringify(dest);
  }

  await prisma.dbBackupJob.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await guardJob(user.id, id))) {
    return NextResponse.json({ ok: false, message: "Job tidak ditemukan / bukan wewenang Anda" }, { status: 403 });
  }
  await prisma.dbBackupJob.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
