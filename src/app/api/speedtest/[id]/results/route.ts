import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { aggregateDaily, aggregateHourly, summarize } from "@/lib/speedtest-report";
import { loadOwnJob, rangeFrom } from "../../_shared";

/** Riwayat hasil + agregasi (harian, per jam, ringkasan) untuk grafik. ?days= atau ?from=&to= */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const job = await loadOwnJob(user.id, id);
  if (!job) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });

  const { from, to } = rangeFrom(new URL(request.url).searchParams, 30);
  const tz = job.timezone || "Asia/Jakarta";
  const rows = await prisma.speedtestResult.findMany({
    where: { jobId: id, startedAt: { gte: from, lte: to } },
    orderBy: { startedAt: "asc" },
    take: 10_000,
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      status: true,
      trigger: true,
      tool: true,
      downloadMbps: true,
      uploadMbps: true,
      pingMs: true,
      jitterMs: true,
      packetLoss: true,
      bytesDown: true,
      bytesUp: true,
      serverName: true,
      serverLocation: true,
      serverHost: true,
      isp: true,
      externalIp: true,
      resultUrl: true,
      error: true,
    },
  });
  const done = rows.filter((r) => r.status !== "running");
  return NextResponse.json({
    ok: true,
    data: {
      from: from.toISOString(),
      to: to.toISOString(),
      timezone: tz,
      running: rows.some((r) => r.status === "running"),
      rows,
      summary: summarize(done),
      daily: aggregateDaily(done, tz, from, to),
      hourly: aggregateHourly(done, tz),
    },
  });
}
