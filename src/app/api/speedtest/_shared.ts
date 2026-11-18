import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveTeam, canUseFeature } from "@/lib/team";
import { SPEEDTEST_TOOLS } from "@/lib/speedtest";

export const SCHEDULE_TYPES = ["manual", "hourly", "daily", "weekly", "monthly", "cron"] as const;

export const jobFields = {
  name: z.string().trim().min(1, "Nama wajib diisi").max(120),
  sshId: z.string().min(1, "Koneksi SSH wajib dipilih"),
  tool: z.enum(SPEEDTEST_TOOLS).default("auto"),
  serverId: z
    .string()
    .trim()
    .regex(/^\d*$/, "ID server speedtest harus berupa angka")
    .max(12)
    .optional()
    .nullable()
    .default(null),
  scheduleType: z.enum(SCHEDULE_TYPES).default("manual"),
  timeAt: z
    .string()
    .regex(/^(\d{2}:\d{2})?$/, "Format jam HH:MM")
    .optional()
    .default(""),
  dayOn: z.coerce.number().int().min(0).max(28).optional().nullable().default(null),
  cronExpr: z.string().max(100).optional().default(""),
  timezone: z.string().min(1).max(64).default("Asia/Jakarta"),
  timeoutSec: z.coerce.number().int().min(30).max(900).default(180),
  minDownloadMbps: z.coerce.number().min(0).max(100000).optional().nullable().default(null),
};

export const createSchema = z.object(jobFields);

export const patchSchema = z
  .object({
    name: jobFields.name,
    sshId: jobFields.sshId,
    tool: z.enum(SPEEDTEST_TOOLS),
    serverId: z.string().trim().regex(/^\d*$/, "ID server speedtest harus berupa angka").max(12).nullable(),
    scheduleType: z.enum(SCHEDULE_TYPES),
    timeAt: z.string().regex(/^(\d{2}:\d{2})?$/, "Format jam HH:MM"),
    dayOn: z.coerce.number().int().min(0).max(28).nullable(),
    cronExpr: z.string().max(100).nullable(),
    timezone: z.string().min(1).max(64),
    timeoutSec: z.coerce.number().int().min(30).max(900),
    minDownloadMbps: z.coerce.number().min(0).max(100000).nullable(),
    enabled: z.boolean(),
  })
  .partial();

/** Job speedtest milik tim yang user boleh pakai (izin fitur SSH), atau null. */
export async function loadOwnJob(userId: string, id: string) {
  const job = await prisma.speedtestJob.findUnique({ where: { id } });
  if (!job?.teamId) return null;
  if (!(await canUseFeature(userId, job.teamId, "ssh"))) return null;
  return job;
}

/** Tim aktif + cek izin fitur SSH. */
export async function activeSshTeam(user: { id: string; name: string; lastTeamId?: string | null }) {
  const team = await getActiveTeam(user);
  const allowed = await canUseFeature(user.id, team.id, "ssh");
  return { team, allowed };
}

/** Rentang tanggal dari query (?from=YYYY-MM-DD&to=YYYY-MM-DD atau ?days=N), zona WIB. */
export function rangeFrom(sp: URLSearchParams, defDays = 30): { from: Date; to: Date } {
  const DAY = 86400000;
  const now = new Date();
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const days = Math.min(366, Math.max(1, Number(sp.get("days")) || defDays));
  let from = new Date(now.getTime() - days * DAY);
  let to = now;
  const f = sp.get("from");
  const t = sp.get("to");
  if (f && re.test(f)) from = new Date(`${f}T00:00:00+07:00`);
  if (t && re.test(t)) to = new Date(`${t}T23:59:59+07:00`);
  if (to > now) to = now;
  if (from >= to) from = new Date(to.getTime() - DAY);
  if (to.getTime() - from.getTime() > 366 * DAY) from = new Date(to.getTime() - 366 * DAY);
  return { from, to };
}
