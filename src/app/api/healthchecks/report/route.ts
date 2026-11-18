import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam, canUseFeature } from "@/lib/team";
import { buildHealthCheckReportBlocks } from "@/lib/healthcheck-report";
import { renderReportPdf, pdfResponse, pdfFilename } from "@/lib/pdf/report";

export const runtime = "nodejs";

const json = (status: number, message: string) =>
  Response.json({ ok: false, message }, { status });

/**
 * Export laporan PDF health check.
 * Query: ids=a,b (kosong = semua check tim), groupId=..., days=1..90
 * atau from=YYYY-MM-DD&to=YYYY-MM-DD (tanggal Asia/Jakarta).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json(401, "Unauthorized");
  const team = await getActiveTeam(user);
  if (!(await canUseFeature(user.id, team.id, "infra"))) return json(403, "Anda tidak diberi izin membuka Health Check");

  const sp = new URL(request.url).searchParams;
  const tz = "Asia/Jakarta";
  let from: Date;
  let to: Date;
  const fromQ = sp.get("from");
  const toQ = sp.get("to");
  if (fromQ && toQ && /^\d{4}-\d{2}-\d{2}$/.test(fromQ) && /^\d{4}-\d{2}-\d{2}$/.test(toQ)) {
    from = new Date(`${fromQ}T00:00:00+07:00`);
    to = new Date(`${toQ}T23:59:59.999+07:00`);
    if (to.getTime() > Date.now()) to = new Date();
  } else {
    const days = Math.min(90, Math.max(1, Number(sp.get("days") ?? 30) || 30));
    to = new Date();
    from = new Date(to.getTime() - days * 86_400_000);
  }
  if (!(from < to)) return json(400, "Rentang tanggal tidak valid");
  if (to.getTime() - from.getTime() > 92 * 86_400_000) return json(400, "Rentang maksimal 92 hari");

  const ids = (sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const groupId = sp.get("groupId") || undefined;
  const checks = await prisma.healthCheck.findMany({
    where: { teamId: team.id, ...(ids.length ? { id: { in: ids } } : {}), ...(groupId ? { groupId } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (!checks.length) return json(404, "Tidak ada health check yang cocok");

  const blocks = await buildHealthCheckReportBlocks(checks.map((c) => c.id), { from, to }, { timezone: tz });
  const title = checks.length === 1 ? `Laporan Health Check - ${checks[0].name}` : "Laporan Health Check";
  const bytes = await renderReportPdf({
    title,
    subtitle: `Tim ${team.name} - ${checks.length} check`,
    timezone: tz,
    blocks,
  });
  return pdfResponse(bytes, pdfFilename(title));
}
