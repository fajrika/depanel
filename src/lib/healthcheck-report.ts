// Laporan health check → blok PDF (lihat src/lib/pdf/report.ts).
// Dipakai oleh export PDF di /healthchecks dan oleh menu Laporan gabungan.
// Pemanggil WAJIB memastikan checkIds milik tim pengguna (tidak dicek di sini).
// Worker-safe: no "server-only", no Next.js imports.
import { prisma } from "./db";
import { dailyBuckets } from "./healthcheck";
import { activeWindowFilter, describeWindow, localDayIndex, DEFAULT_HEALTH_TZ } from "./healthcheck-window";
import { formatPdfDate, type ReportBlock, type ReportState } from "./pdf/report";

export interface HealthReportRange {
  from: Date;
  to: Date;
}

export interface HealthCheckRangeSummary {
  id: string;
  name: string;
  url: string;
  group: string | null;
  enabled: boolean;
  windowLabel: string;
  timezone: string;
  total: number;
  up: number;
  down: number;
  excluded: number; // sampel di luar jendela aktif (tidak dihitung)
  uptimePct: number | null;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  incidents: { start: Date; end: Date | null; samples: number; error: string | null }[];
  daily: { label: string; date: string; pct: number | null; total: number; up: number }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Ringkasan uptime satu check untuk rentang waktu, menghormati jendela aktif. */
export async function summarizeHealthCheck(checkId: string, range: HealthReportRange): Promise<HealthCheckRangeSummary | null> {
  const hc = await prisma.healthCheck.findUnique({ where: { id: checkId }, include: { group: { select: { name: true } } } });
  if (!hc) return null;
  const tz = hc.timezone || DEFAULT_HEALTH_TZ;
  const inWindow = activeWindowFilter(hc);
  const all = await prisma.healthCheckSample.findMany({
    where: { checkId, at: { gte: range.from, lte: range.to } },
    orderBy: { at: "asc" },
    select: { at: true, ok: true, latencyMs: true, error: true, statusCode: true },
  });
  const samples = all.filter((s) => inWindow(s.at));
  const up = samples.filter((s) => s.ok).length;
  const lat = samples.map((s) => s.latencyMs).filter((v): v is number => typeof v === "number");

  // insiden = rangkaian sampel gagal berturut-turut (di dalam jendela aktif)
  const incidents: HealthCheckRangeSummary["incidents"] = [];
  let cur: HealthCheckRangeSummary["incidents"][number] | null = null;
  for (const s of samples) {
    if (!s.ok) {
      if (!cur) cur = { start: s.at, end: null, samples: 0, error: s.error ?? (s.statusCode ? `status ${s.statusCode}` : null) };
      cur.samples++;
    } else if (cur) {
      cur.end = s.at;
      incidents.push(cur);
      cur = null;
    }
  }
  if (cur) incidents.push(cur);

  const days = Math.min(93, Math.max(1, localDayIndex(range.to, tz) - localDayIndex(range.from, tz) + 1));

  return {
    id: hc.id,
    name: hc.name,
    url: hc.url,
    group: hc.group?.name ?? null,
    enabled: hc.enabled,
    windowLabel: describeWindow(hc),
    timezone: tz,
    total: samples.length,
    up,
    down: samples.length - up,
    excluded: all.length - samples.length,
    uptimePct: samples.length ? round1((up / samples.length) * 100) : null,
    avgLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
    maxLatencyMs: lat.length ? Math.max(...lat) : null,
    incidents,
    daily: dailyBuckets(samples, range.to.getTime(), days, tz),
  };
}

function pctState(p: number | null): ReportState {
  if (p === null) return "none";
  if (p >= 100) return "up";
  if (p <= 0) return "down";
  return "partial";
}

const fmtPct = (p: number | null) => (p === null ? "-" : `${p.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`);

function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} j ${m % 60} mnt`;
  return `${Math.floor(h / 24)} h ${h % 24} j`;
}

/**
 * Blok laporan untuk sekumpulan health check pada rentang `range`.
 * Menghasilkan: ringkasan semua check (tabel), lalu per check: info, strip
 * harian, dan daftar insiden.
 */
export async function buildHealthCheckReportBlocks(
  checkIds: string[],
  range: HealthReportRange,
  opts: {
    timezone?: string;
    maxIncidents?: number;
    /** false = tanpa heading "Health Check" (mis. pemanggil sudah punya heading kategori). */
    sectionHeading?: boolean;
    /** Level heading per check. Default 2. */
    itemHeadingLevel?: 1 | 2 | 3;
  } = {},
): Promise<ReportBlock[]> {
  const tz = opts.timezone || DEFAULT_HEALTH_TZ;
  const maxInc = opts.maxIncidents ?? 50;
  const h2 = opts.itemHeadingLevel ?? 2;
  const summaries = (await Promise.all(checkIds.map((id) => summarizeHealthCheck(id, range)))).filter(
    (s): s is HealthCheckRangeSummary => !!s,
  );

  const blocks: ReportBlock[] = [
    ...(opts.sectionHeading === false ? [] : [{ type: "heading", text: "Health Check", level: 1 } as ReportBlock]),
    {
      type: "text",
      muted: true,
      text: `Periode ${formatPdfDate(range.from, tz)} s/d ${formatPdfDate(range.to, tz)} (${tz}). Persentase uptime hanya menghitung pengecekan di dalam jam aktif masing-masing check; waktu di luar jadwal tidak dihitung.`,
    },
  ];
  if (!summaries.length) {
    blocks.push({ type: "text", text: "Tidak ada health check yang dipilih." });
    return blocks;
  }

  const totalUp = summaries.reduce((a, s) => a + s.up, 0);
  const totalAll = summaries.reduce((a, s) => a + s.total, 0);
  blocks.push(
    {
      type: "kv",
      rows: [
        ["Jumlah check", summaries.length],
        ["Uptime gabungan", fmtPct(totalAll ? round1((totalUp / totalAll) * 100) : null)],
        ["Total pengecekan", totalAll.toLocaleString("id-ID")],
        ["Total insiden", summaries.reduce((a, s) => a + s.incidents.length, 0)],
      ],
    },
    {
      type: "table",
      columns: [
        { label: "Nama", width: 2.2 },
        { label: "Grup", width: 1.2 },
        { label: "Jam aktif", width: 1.8 },
        { label: "Uptime", width: 0.9, align: "right" },
        { label: "Cek", width: 0.8, align: "right" },
        { label: "Gagal", width: 0.7, align: "right" },
        { label: "Rata2 ms", width: 0.9, align: "right" },
        { label: "Insiden", width: 0.8, align: "right" },
      ],
      rows: summaries.map((s) => [
        s.name,
        s.group ?? "-",
        s.windowLabel,
        fmtPct(s.uptimePct),
        s.total,
        s.down,
        s.avgLatencyMs,
        s.incidents.length,
      ]),
      rowStates: summaries.map((s) => (s.uptimePct === null ? null : s.uptimePct < 95 ? "down" : s.uptimePct < 100 ? "partial" : null)),
    },
  );

  for (const s of summaries) {
    blocks.push(
      { type: "heading", text: s.name, level: h2 },
      {
        type: "kv",
        rows: [
          ["URL", s.url],
          ["Grup", s.group ?? "-"],
          ["Status", s.enabled ? "Aktif" : "Nonaktif"],
          ["Jam aktif", s.windowLabel],
          ["Uptime", fmtPct(s.uptimePct)],
          ["Pengecekan", `${s.total} (${s.up} up, ${s.down} gagal)${s.excluded ? `, ${s.excluded} di luar jadwal diabaikan` : ""}`],
          ["Latensi", s.avgLatencyMs === null ? "-" : `rata-rata ${s.avgLatencyMs} ms, maks ${s.maxLatencyMs} ms`],
        ],
      },
    );
    if (s.daily.length > 1) {
      blocks.push({
        type: "statusStrip",
        items: s.daily.map((d) => ({ label: d.label, state: pctState(d.pct) })),
        caption: "Uptime harian: hijau 100%, kuning sebagian, merah 0%, abu-abu tidak ada data.",
      });
    }
    if (s.incidents.length) {
      const shown = s.incidents.slice(-maxInc).reverse();
      blocks.push({
        type: "table",
        columns: [
          { label: "Mulai", width: 1.3 },
          { label: "Pulih", width: 1.3 },
          { label: "Durasi", width: 0.9, align: "right" },
          { label: "Cek gagal", width: 0.8, align: "right" },
          { label: "Error", width: 2.7 },
        ],
        rows: shown.map((i) => [
          formatPdfDate(i.start, tz),
          i.end ? formatPdfDate(i.end, tz) : "belum pulih",
          i.end ? fmtDuration(i.end.getTime() - i.start.getTime()) : "-",
          i.samples,
          i.error,
        ]),
        rowStates: shown.map((i) => (i.end ? null : "down")),
      });
      if (s.incidents.length > maxInc) {
        blocks.push({ type: "text", muted: true, text: `Menampilkan ${maxInc} insiden terakhir dari ${s.incidents.length}.` });
      }
    } else if (s.total) {
      blocks.push({ type: "text", muted: true, text: "Tidak ada insiden pada periode ini." });
    } else {
      blocks.push({ type: "text", muted: true, text: "Belum ada data pengecekan pada periode ini." });
    }
  }
  return blocks;
}
