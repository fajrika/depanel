import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { renderReportPdf, pdfResponse, pdfFilename } from "@/lib/pdf/report";
import { loadSshCmdReportData, parseRunFilter, sshCmdJobsToBlocks, periodLabel } from "@/lib/sshcmd-report";
import { logActivity } from "@/lib/power";

/**
 * Ekspor riwayat satu job SSH command sebagai laporan PDF.
 * Query: status, from, to (sama seperti /runs), output=0 untuk tanpa detail output,
 * limit (maks run dimuat, default 500, maks 5000).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const job = await prisma.sshCommandJob.findUnique({ where: { id }, select: { teamId: true, name: true, timezone: true } });
  if (!job?.teamId) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });
  const member = await prisma.teamMember.findFirst({ where: { userId: user.id, teamId: job.teamId }, select: { teamId: true } });
  if (!member) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });

  const sp = new URL(request.url).searchParams;
  const filter = parseRunFilter(sp);
  const timezone = job.timezone || "Asia/Jakarta";
  const opts = {
    ...filter,
    jobIds: [id],
    includeOutput: sp.get("output") !== "0",
    maxRunsPerJob: Math.min(5000, Math.max(1, Number(sp.get("limit")) || 500)),
    timezone,
  };

  const jobs = await loadSshCmdReportData(opts);
  const bytes = await renderReportPdf({
    title: `Laporan SSH Command — ${job.name}`,
    subtitle: periodLabel(filter, timezone),
    timezone,
    generatedAt: new Date(),
    blocks: sshCmdJobsToBlocks(jobs, opts),
  });

  await logActivity({ teamId: job.teamId, userId: user.id, action: "sshcmd-report", message: `Ekspor laporan PDF SSH command "${job.name}"` });
  return pdfResponse(bytes, pdfFilename(`laporan-sshcmd-${job.name}`, new Date(), timezone));
}
