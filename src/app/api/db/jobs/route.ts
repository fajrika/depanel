import { NextResponse } from "next/server";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";
import { encryptSecret } from "@/lib/crypto";

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
      runs: { orderBy: { startedAt: "desc" }, take: 5 },
    },
  });
  const data = jobs.map((j) => {
    const dest = JSON.parse(j.destConfig) as Record<string, unknown>;
    // never expose encrypted/secret fields to the browser
    delete dest.passwordEnc;
    delete dest.secretKeyEnc;
    delete dest.serviceAccountKeyEnc;
    return {
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
      dest,
      retention: j.retention,
      enabled: j.enabled,
      lastRunAt: j.lastRunAt,
      lastStatus: j.lastStatus,
      runs: j.runs,
    };
  });
  return NextResponse.json({ ok: true, data });
}

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const createSchema = z
  .object({
    name: z.string().min(1),
    connectionId: z.string().min(1),
    databases: z.array(z.string().min(1)).min(1, "Pilih minimal satu database"),
    scheduleType: z.enum(["daily", "weekly", "monthly", "cron"]),
    timeAt: z.string().regex(timeRe).optional(),
    dayOn: z.number().int().min(0).max(28).optional(),
    cronExpr: z.string().optional(),
    timezone: z.string().default("Asia/Jakarta"),
    destType: z.enum(["local", "ftp", "s3", "gdrive"]),
    dest: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    retention: z.number().int().min(0).max(1000).default(0), // 0 = keep all, N = keep last N
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
      ctx.addIssue({ code: "custom", message: "Jam backup wajib diisi" });
    }
    if (v.scheduleType === "weekly" && v.dayOn === undefined)
      ctx.addIssue({ code: "custom", message: "Pilih hari untuk backup mingguan" });
    if (v.scheduleType === "monthly" && (v.dayOn === undefined || v.dayOn < 1))
      ctx.addIssue({ code: "custom", message: "Pilih tanggal (1-28) untuk backup bulanan" });
    if (v.destType === "local" && !v.dest.path)
      ctx.addIssue({ code: "custom", message: "Path tujuan wajib diisi" });
    if (v.destType === "ftp" && (!v.dest.host || !v.dest.username))
      ctx.addIssue({ code: "custom", message: "Host & username FTP wajib diisi" });
    if (v.destType === "s3" && (!v.dest.bucket || !v.dest.accessKeyId))
      ctx.addIssue({ code: "custom", message: "Bucket & access key S3 wajib diisi" });
    if (v.destType === "gdrive" && (!v.dest.serviceAccountKey || !v.dest.folderId))
      ctx.addIssue({ code: "custom", message: "Service Account Key & Folder ID (Shared Drive) wajib diisi" });
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

  // encrypt secrets inside dest config before storing
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
      destConfig: JSON.stringify(dest),
      retention: v.retention,
    },
  });
  return NextResponse.json({ ok: true, data: { id: job.id } });
}
