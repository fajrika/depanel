import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/power";
import { activeSshTeam, createSchema } from "./_shared";

/** Daftar job speedtest tim aktif + hasil sukses terakhir masing-masing. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { team, allowed } = await activeSshTeam(user);
  if (!allowed) return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuka Speedtest" }, { status: 403 });

  const jobs = await prisma.speedtestJob.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: "asc" },
    include: {
      ssh: { select: { id: true, name: true, host: true } },
      _count: { select: { results: true } },
      results: {
        where: { status: "success" },
        orderBy: { startedAt: "desc" },
        take: 1,
        select: { startedAt: true, tool: true, downloadMbps: true, uploadMbps: true, pingMs: true, jitterMs: true, serverName: true, serverLocation: true },
      },
    },
  });
  const lastFail = await prisma.speedtestResult.findMany({
    where: { jobId: { in: jobs.map((j) => j.id) }, status: "failed" },
    orderBy: { startedAt: "desc" },
    distinct: ["jobId"],
    select: { jobId: true, error: true, startedAt: true },
  });
  return NextResponse.json({
    ok: true,
    data: jobs.map(({ results, ...j }) => ({
      ...j,
      last: results[0] ?? null,
      lastError: j.lastStatus === "failed" ? (lastFail.find((f) => f.jobId === j.id)?.error ?? null) : null,
    })),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  const d = parsed.data;

  const { team, allowed } = await activeSshTeam(user);
  if (!allowed) return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuat speedtest" }, { status: 403 });
  const ssh = await prisma.sshConnection.findUnique({ where: { id: d.sshId }, select: { teamId: true } });
  if (!ssh || ssh.teamId !== team.id) return NextResponse.json({ ok: false, message: "Koneksi SSH tidak ditemukan" }, { status: 404 });
  if (d.scheduleType === "cron" && !d.cronExpr?.trim()) return NextResponse.json({ ok: false, message: "Cron expression wajib diisi" }, { status: 400 });
  if (["daily", "weekly", "monthly"].includes(d.scheduleType) && !d.timeAt) return NextResponse.json({ ok: false, message: "Jam wajib diisi" }, { status: 400 });

  const job = await prisma.speedtestJob.create({
    data: {
      teamId: team.id,
      name: d.name,
      sshId: d.sshId,
      tool: d.tool,
      serverId: d.serverId || null,
      scheduleType: d.scheduleType,
      timeAt: d.timeAt || null,
      dayOn: d.dayOn ?? null,
      cronExpr: d.cronExpr || null,
      timezone: d.timezone,
      timeoutSec: d.timeoutSec,
      minDownloadMbps: d.minDownloadMbps || null,
    },
  });
  await logActivity({ teamId: team.id, userId: user.id, action: "speedtest-create", message: `Buat speedtest "${d.name}"` });
  return NextResponse.json({ ok: true, data: { id: job.id } });
}
