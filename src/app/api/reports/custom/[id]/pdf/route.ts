import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/power";
import { buildCustomReport, parseItems, parseMode, resolveRange } from "@/lib/customreport";
import { renderReportPdf, pdfResponse } from "@/lib/pdf/report";
import { loadOwnReport } from "../../_shared";

export const runtime = "nodejs";

/** Unduh laporan gabungan sebagai PDF. ?from=YYYY-MM-DD&to=YYYY-MM-DD opsional, ?mode=summary untuk versi ringkas (manajer). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const own = await loadOwnReport(user, id);
  if (!own) return NextResponse.json({ ok: false, message: "Laporan tidak ditemukan" }, { status: 404 });
  const { report, team } = own;
  const sp = new URL(request.url).searchParams;
  const { from, to } = resolveRange(sp, report.rangeDays);
  const mode = parseMode(sp);
  const spec = await buildCustomReport({
    teamId: team.id,
    teamName: team.name,
    userId: user.id,
    name: report.name,
    description: report.description,
    items: parseItems(report.items),
    from,
    to,
    timezone: report.timezone,
    mode,
  });
  const bytes = await renderReportPdf(spec);
  await logActivity({ teamId: team.id, userId: user.id, action: "report-export", message: `Ekspor PDF laporan ${mode === "summary" ? "ringkas " : ""}"${report.name}"` });
  const slug = report.name.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "laporan";
  return pdfResponse(bytes, `Laporan-${mode === "summary" ? "Ringkas-" : ""}${slug}-${to.toISOString().slice(0, 10)}.pdf`);
}
