import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildCustomReport, parseItems, resolveRange } from "@/lib/customreport";
import { loadOwnReport } from "../../_shared";

/** Isi laporan (ReportSpec JSON) untuk preview di halaman. ?from=&to= opsional. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const own = await loadOwnReport(user, id);
  if (!own) return NextResponse.json({ ok: false, message: "Laporan tidak ditemukan" }, { status: 404 });
  const { report, team } = own;
  const { from, to } = resolveRange(new URL(request.url).searchParams, report.rangeDays);
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
  });
  return NextResponse.json({ ok: true, data: { ...spec, from: from.toISOString(), to: to.toISOString() } });
}
