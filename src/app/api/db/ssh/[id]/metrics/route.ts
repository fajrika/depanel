import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";

const WINDOWS: Record<string, number> = { hour: 1, day: 24, week: 168, month: 720 };

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const ssh = await prisma.sshConnection.findUnique({ where: { id } });
  if (!ssh?.teamId) return NextResponse.json({ ok: false, message: "Koneksi SSH tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, ssh.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  const periode = (new URL(request.url).searchParams.get("periode") ?? "hour") as keyof typeof WINDOWS;
  const hours = WINDOWS[periode] ?? 1;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const samples = await prisma.sshMetricSample.findMany({
    where: { sshId: id, at: { gte: since } },
    orderBy: { at: "asc" },
    select: { at: true, ok: true, cpu: true, memPct: true, memUsedMb: true, memTotalMb: true, netInBps: true, netOutBps: true },
  });

  const data = {
    periode,
    samples: samples.map((s) => ({
      t: s.at.toISOString(),
      ok: s.ok,
      cpu: s.cpu,
      memPct: s.memPct,
      memUsedMb: s.memUsedMb,
      memTotalMb: s.memTotalMb,
      netInBps: s.netInBps,
      netOutBps: s.netOutBps,
    })),
  };
  return NextResponse.json({ ok: true, data });
}
