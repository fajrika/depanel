import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
import { logActivity } from "@/lib/power";

const JOB_SELECT = {
  id: true,
  name: true,
  sourcePath: true,
  destType: true,
  destPath: true,
  destGdriveId: true,
  scheduleType: true,
  timeAt: true,
  dayOn: true,
  cronExpr: true,
  timezone: true,
  retention: true,
  enabled: true,
  lastRunAt: true,
  lastStatus: true,
  sourceSsh: { select: { id: true, name: true, host: true } },
  destSsh: { select: { id: true, name: true, host: true } },
} as const;

const createSchema = z.object({
  name: z.string().min(1),
  sourceSshId: z.string().min(1),
  sourcePath: z.string().min(1).refine((p) => p.startsWith("/"), "Path sumber harus absolut (diawali /)"),
  destType: z.enum(["local", "gdrive", "ssh"]),
  destPath: z.string().optional().default(""),
  destSshId: z.string().optional().default(""),
  destGdriveId: z.string().optional().default(""),
  scheduleType: z.enum(["manual", "daily", "weekly", "monthly", "cron"]).default("manual"),
  timeAt: z.string().optional().default(""),
  dayOn: z.coerce.number().int().min(0).max(28).optional().nullable().default(null),
  cronExpr: z.string().optional().default(""),
  timezone: z.string().default("Asia/Jakarta"),
  retention: z.coerce.number().int().min(0).default(0),
});

/** Validasi koneksi SSH/Dest milik tim yang sama. */
async function validateRefs(
  teamId: string,
  d: { sourceSshId: string; destSshId?: string; destGdriveId?: string },
): Promise<string | null> {
  const src = await prisma.sshConnection.findUnique({ where: { id: d.sourceSshId }, select: { teamId: true } });
  if (!src?.teamId || src.teamId !== teamId) return "Koneksi SSH sumber tidak ditemukan";
  if (d.destSshId) {
    const dst = await prisma.sshConnection.findUnique({ where: { id: d.destSshId }, select: { teamId: true } });
    if (!dst?.teamId || dst.teamId !== teamId) return "Koneksi SSH tujuan tidak ditemukan";
  }
  if (d.destGdriveId) {
    const gd = await prisma.dbDest.findUnique({ where: { id: d.destGdriveId }, select: { teamId: true, type: true } });
    if (!gd?.teamId || gd.teamId !== teamId || gd.type !== "gdrive") return "Koneksi Google Drive tujuan tidak ditemukan";
  }
  return null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const memberships = await prisma.teamMember.findMany({ where: { userId: user.id }, select: { teamId: true } });
  const jobs = await prisma.dirCloneJob.findMany({
    where: { teamId: { in: memberships.map((m) => m.teamId) } },
    orderBy: { createdAt: "desc" },
    select: { ...JOB_SELECT, runs: { orderBy: { startedAt: "desc" }, take: 5 } },
  });
  return NextResponse.json({ ok: true, data: jobs });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Data tidak valid";
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
  const d = parsed.data;

  const team = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: (await prisma.sshConnection.findUnique({ where: { id: d.sourceSshId } }))?.teamId ?? "", userId: user.id } },
  });
  if (!team) return NextResponse.json({ ok: false, message: "Koneksi SSH sumber tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, team.teamId, "backupDb"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuat job clone" }, { status: 403 });
  }
  const refErr = await validateRefs(team.teamId, d);
  if (refErr) return NextResponse.json({ ok: false, message: refErr }, { status: 400 });

  const job = await prisma.dirCloneJob.create({
    data: {
      teamId: team.teamId,
      name: d.name,
      sourceSshId: d.sourceSshId,
      sourcePath: d.sourcePath,
      destType: d.destType,
      destPath: d.destPath || null,
      destSshId: d.destType === "ssh" && d.destSshId ? d.destSshId : null,
      destGdriveId: d.destType === "gdrive" && d.destGdriveId ? d.destGdriveId : null,
      scheduleType: d.scheduleType,
      timeAt: d.timeAt || null,
      dayOn: d.dayOn ?? null,
      cronExpr: d.cronExpr || null,
      timezone: d.timezone,
      retention: d.retention,
    },
  });
  await logActivity({ teamId: team.teamId, userId: user.id, action: "dirclone-create", message: `Buat job clone "${d.name}"` });
  return NextResponse.json({ ok: true, data: { id: job.id } });
}
