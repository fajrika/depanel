import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/power";
import { renderReportPdf, pdfResponse, pdfFilename, formatPdfDate, type ReportBlock } from "@/lib/pdf/report";
import { loadSpeedReportData, speedCompareBlocks, speedJobBlocks } from "@/lib/speedtest-report";
import { activeSshTeam, rangeFrom } from "../_shared";

export const runtime = "nodejs";

/** Ekspor PDF speedtest. ?ids=a,b (default: semua job tim aktif), ?days= atau ?from=&to= */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { team, allowed } = await activeSshTeam(user);
  if (!allowed) return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuka Speedtest" }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const want = (sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const own = await prisma.speedtestJob.findMany({
    where: { teamId: team.id, ...(want.length ? { id: { in: want } } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (!own.length) return NextResponse.json({ ok: false, message: "Job speedtest tidak ditemukan" }, { status: 404 });

  const { from, to } = rangeFrom(sp, 30);
  const tz = "Asia/Jakarta";
  const jobs = await loadSpeedReportData(own.map((j) => j.id), from, to);
  const blocks: ReportBlock[] = [
    {
      type: "kv",
      rows: [
        ["Tim", team.name],
        ["Periode", `${formatPdfDate(from, tz)} s/d ${formatPdfDate(to, tz)} (${tz})`],
        ["Jumlah job", String(jobs.length)],
      ],
    },
  ];
  const cmp = speedCompareBlocks(jobs);
  if (cmp.length) blocks.push({ type: "heading", text: "Perbandingan", level: 1 }, ...cmp);
  for (const j of jobs) {
    blocks.push(...speedJobBlocks(j, { timezone: tz, from, to, headingLevel: jobs.length > 1 ? 1 : 2 }));
  }
  const title = jobs.length === 1 ? `Laporan Speedtest - ${jobs[0].name}` : "Laporan Speedtest";
  const bytes = await renderReportPdf({ title, subtitle: `Kecepatan internet server SSH - ${team.name}`, timezone: tz, generatedAt: new Date(), blocks });
  await logActivity({ teamId: team.id, userId: user.id, action: "speedtest-report", message: `Ekspor PDF ${title}` });
  return pdfResponse(bytes, pdfFilename(jobs.length === 1 ? `speedtest-${jobs[0].name}` : "speedtest", new Date(), tz));
}
