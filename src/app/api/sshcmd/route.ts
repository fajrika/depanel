import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
import { logActivity } from "@/lib/power";

const JOB_SELECT = {
  id: true,
  name: true,
  sshId: true,
  command: true,
  scheduleType: true,
  timeAt: true,
  dayOn: true,
  cronExpr: true,
  timezone: true,
  timeoutSec: true,
  enabled: true,
  lastStatus: true,
  lastRunAt: true,
  ssh: { select: { id: true, name: true, host: true } },
} as const;

const createSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi"),
  sshId: z.string().min(1, "Koneksi SSH wajib dipilih"),
  command: z.string().min(1, "Perintah wajib diisi"),
  scheduleType: z.enum(["manual", "daily", "weekly", "monthly", "cron"]).default("manual"),
  timeAt: z.string().optional().default(""),
  dayOn: z.coerce.number().int().min(0).max(28).optional().nullable().default(null),
  cronExpr: z.string().optional().default(""),
  timezone: z.string().default("Asia/Jakarta"),
  timeoutSec: z.coerce.number().int().min(1).max(3600).default(60),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const memberships = await prisma.teamMember.findMany({ where: { userId: user.id }, select: { teamId: true } });
  const jobs = await prisma.sshCommandJob.findMany({
    where: { teamId: { in: memberships.map((m) => m.teamId) } },
    orderBy: { createdAt: "desc" },
    select: {
      ...JOB_SELECT,
      runs: {
        orderBy: { startedAt: "desc" },
        take: 5,
        select: { id: true, status: true, exitCode: true, output: true, error: true, startedAt: true, endedAt: true },
      },
    },
  });
  return NextResponse.json({ ok: true, data: jobs });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;

  const ssh = await prisma.sshConnection.findUnique({ where: { id: d.sshId }, select: { teamId: true } });
  if (!ssh?.teamId) return NextResponse.json({ ok: false, message: "Koneksi SSH tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, ssh.teamId, "ssh"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuat job" }, { status: 403 });
  }

  const job = await prisma.sshCommandJob.create({
    data: {
      teamId: ssh.teamId,
      name: d.name,
      sshId: d.sshId,
      command: d.command,
      scheduleType: d.scheduleType,
      timeAt: d.timeAt || null,
      dayOn: d.dayOn ?? null,
      cronExpr: d.cronExpr || null,
      timezone: d.timezone,
      timeoutSec: d.timeoutSec,
    },
  });
  await logActivity({ teamId: ssh.teamId, userId: user.id, action: "sshcmd-create", message: `Buat job SSH command "${d.name}"` });
  return NextResponse.json({ ok: true, data: { id: job.id } });
}
