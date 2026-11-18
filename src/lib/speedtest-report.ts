// Laporan speedtest: agregasi hasil (rata-rata, harian, per jam) + penyusun blok
// laporan (statistik, grafik, tabel) yang dipakai ulang oleh halaman /speedtest
// (ekspor PDF) dan menu Laporan gabungan. Worker-safe (tanpa next/headers).
// PENTING: tidak ada cek izin di sini — pemanggil wajib memastikan jobIds milik tim user.
import { prisma } from "./db";
import type { ReportBlock, StatItem } from "./pdf/report";
import { TOOL_LABEL } from "./speedtest";

/** Warna seri — sama untuk grafik di halaman & PDF (urutan kategorikal tetap). */
export const SPEED_COLORS = {
  download: "#2a78d6",
  upload: "#eb6834",
  ping: "#1baf7a",
  jitter: "#eda100",
  loss: "#6250d6",
} as const;

export type SpeedRow = {
  startedAt: Date;
  status: string;
  tool: string | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  pingMs: number | null;
  jitterMs: number | null;
  packetLoss: number | null;
  serverName: string | null;
  serverLocation: string | null;
  isp: string | null;
  externalIp: string | null;
  error: string | null;
};

export type DayAgg = {
  day: string; // YYYY-MM-DD lokal
  tests: number;
  failed: number;
  downAvg: number | null;
  downMin: number | null;
  downMax: number | null;
  upAvg: number | null;
  pingAvg: number | null;
  jitterAvg: number | null;
  lossAvg: number | null;
};

const finite = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
export const avgOf = (xs: (number | null | undefined)[]) => {
  const v = finite(xs);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const minOf = (xs: (number | null | undefined)[]) => {
  const v = finite(xs);
  return v.length ? Math.min(...v) : null;
};
const maxOf = (xs: (number | null | undefined)[]) => {
  const v = finite(xs);
  return v.length ? Math.max(...v) : null;
};
/** Persentil (0..1) sederhana. */
const pctl = (xs: (number | null | undefined)[], p: number) => {
  const v = finite(xs).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
};

export function dayKey(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function hourOf(d: Date, tz: string): number {
  try {
    const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(d));
    return Number.isFinite(h) ? h % 24 : d.getUTCHours();
  } catch {
    return d.getUTCHours();
  }
}

/** Agregasi per hari, berurutan naik; hari tanpa tes di antara from..to diisi kosong. */
export function aggregateDaily(rows: SpeedRow[], tz: string, from?: Date, to?: Date): DayAgg[] {
  const by = new Map<string, SpeedRow[]>();
  for (const r of rows) {
    const k = dayKey(r.startedAt, tz);
    const arr = by.get(k) ?? [];
    arr.push(r);
    by.set(k, arr);
  }
  const keys = new Set(by.keys());
  if (from && to && to.getTime() - from.getTime() <= 400 * 86400000) {
    for (let t = from.getTime(); t <= to.getTime(); t += 86400000) keys.add(dayKey(new Date(t), tz));
    keys.add(dayKey(to, tz));
  }
  return [...keys].sort().map((day) => {
    const all = by.get(day) ?? [];
    const ok = all.filter((r) => r.status === "success");
    return {
      day,
      tests: all.length,
      failed: all.filter((r) => r.status === "failed").length,
      downAvg: avgOf(ok.map((r) => r.downloadMbps)),
      downMin: minOf(ok.map((r) => r.downloadMbps)),
      downMax: maxOf(ok.map((r) => r.downloadMbps)),
      upAvg: avgOf(ok.map((r) => r.uploadMbps)),
      pingAvg: avgOf(ok.map((r) => r.pingMs)),
      jitterAvg: avgOf(ok.map((r) => r.jitterMs)),
      lossAvg: avgOf(ok.map((r) => r.packetLoss)),
    };
  });
}

/** Rata-rata download/upload per jam (0..23) — pola jam sibuk. */
export function aggregateHourly(rows: SpeedRow[], tz: string) {
  const buckets = Array.from({ length: 24 }, () => ({ down: [] as number[], up: [] as number[], ping: [] as number[] }));
  for (const r of rows) {
    if (r.status !== "success") continue;
    const b = buckets[hourOf(r.startedAt, tz)];
    if (r.downloadMbps != null) b.down.push(r.downloadMbps);
    if (r.uploadMbps != null) b.up.push(r.uploadMbps);
    if (r.pingMs != null) b.ping.push(r.pingMs);
  }
  return buckets.map((b, h) => ({ hour: h, tests: b.down.length, downAvg: avgOf(b.down), upAvg: avgOf(b.up), pingAvg: avgOf(b.ping) }));
}

export function summarize(rows: SpeedRow[]) {
  const ok = rows.filter((r) => r.status === "success");
  const failed = rows.filter((r) => r.status === "failed").length;
  return {
    total: rows.length,
    success: ok.length,
    failed,
    successRate: rows.length ? (ok.length / Math.max(1, ok.length + failed)) * 100 : null,
    downAvg: avgOf(ok.map((r) => r.downloadMbps)),
    downMin: minOf(ok.map((r) => r.downloadMbps)),
    downMax: maxOf(ok.map((r) => r.downloadMbps)),
    downP10: pctl(ok.map((r) => r.downloadMbps), 0.1),
    upAvg: avgOf(ok.map((r) => r.uploadMbps)),
    upMin: minOf(ok.map((r) => r.uploadMbps)),
    upMax: maxOf(ok.map((r) => r.uploadMbps)),
    pingAvg: avgOf(ok.map((r) => r.pingMs)),
    pingMin: minOf(ok.map((r) => r.pingMs)),
    pingMax: maxOf(ok.map((r) => r.pingMs)),
    jitterAvg: avgOf(ok.map((r) => r.jitterMs)),
    lossAvg: avgOf(ok.map((r) => r.packetLoss)),
    last: ok.length ? ok[ok.length - 1] : null,
  };
}

/* ------------------------------------------------------------------ */
/* Format                                                               */
/* ------------------------------------------------------------------ */

const nf = (v: number | null | undefined, d = 1) => (v == null ? "-" : v.toLocaleString("id-ID", { maximumFractionDigits: d, minimumFractionDigits: 0 }));
export const fmtMbps = (v: number | null | undefined) => (v == null ? "-" : `${nf(v, v >= 100 ? 0 : 1)} Mbps`);
export const fmtMs = (v: number | null | undefined) => (v == null ? "-" : `${nf(v, v >= 100 ? 0 : 1)} ms`);
const pct = (v: number | null | undefined) => (v == null ? "-" : `${nf(v, 1)}%`);

function safe(s: string | null | undefined, max = 0): string {
  let v = (s ?? "").replace(/[\r\t]/g, " ").replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "?");
  if (max && v.length > max) v = v.slice(0, max - 3) + "...";
  return v;
}

function fmtDate(d: Date, tz: string, withTime = true): string {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: tz,
      day: "2-digit",
      month: "short",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : { year: "numeric" }),
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

function scheduleText(j: { scheduleType: string; timeAt: string | null; dayOn: number | null; cronExpr: string | null }): string {
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  switch (j.scheduleType) {
    case "manual":
      return "Manual";
    case "hourly":
      return "Tiap jam";
    case "daily":
      return `Harian ${j.timeAt ?? ""}`.trim();
    case "weekly":
      return `Mingguan, ${days[j.dayOn ?? 0] ?? "-"} ${j.timeAt ?? ""}`.trim();
    case "monthly":
      return `Bulanan tgl ${j.dayOn ?? "-"} ${j.timeAt ?? ""}`.trim();
    default:
      return `Cron ${j.cronExpr ?? ""}`.trim();
  }
}

/* ------------------------------------------------------------------ */
/* Data + blok laporan                                                  */
/* ------------------------------------------------------------------ */

export type SpeedReportJob = {
  id: string;
  name: string;
  tool: string;
  scheduleType: string;
  timeAt: string | null;
  dayOn: number | null;
  cronExpr: string | null;
  timezone: string;
  enabled: boolean;
  minDownloadMbps: number | null;
  ssh: { name: string; host: string } | null;
  rows: SpeedRow[];
};

const ROW_SELECT = {
  startedAt: true,
  status: true,
  tool: true,
  downloadMbps: true,
  uploadMbps: true,
  pingMs: true,
  jitterMs: true,
  packetLoss: true,
  serverName: true,
  serverLocation: true,
  isp: true,
  externalIp: true,
  error: true,
} as const;

/** Batas hasil per job yang dimuat (cukup untuk tes tiap jam selama ~1 tahun). */
const MAX_ROWS = 10_000;

export async function loadSpeedReportData(jobIds: string[], from: Date, to: Date): Promise<SpeedReportJob[]> {
  if (!jobIds.length) return [];
  const jobs = await prisma.speedtestJob.findMany({
    where: { id: { in: jobIds } },
    include: { ssh: { select: { name: true, host: true } } },
  });
  const order = new Map(jobIds.map((id, i) => [id, i]));
  jobs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const out: SpeedReportJob[] = [];
  for (const j of jobs) {
    const rows = await prisma.speedtestResult.findMany({
      where: { jobId: j.id, startedAt: { gte: from, lte: to }, status: { not: "running" } },
      orderBy: { startedAt: "asc" },
      take: MAX_ROWS,
      select: ROW_SELECT,
    });
    out.push({
      id: j.id,
      name: j.name,
      tool: j.tool,
      scheduleType: j.scheduleType,
      timeAt: j.timeAt,
      dayOn: j.dayOn,
      cronExpr: j.cronExpr,
      timezone: j.timezone,
      enabled: j.enabled,
      minDownloadMbps: j.minDownloadMbps,
      ssh: j.ssh,
      rows,
    });
  }
  return out;
}

export function speedStatTiles(s: ReturnType<typeof summarize>, minDown?: number | null): StatItem[] {
  return [
    {
      label: "Rata-rata download",
      value: fmtMbps(s.downAvg),
      sub: `min ${fmtMbps(s.downMin)} / maks ${fmtMbps(s.downMax)}`,
      tone: minDown && s.downAvg != null && s.downAvg < minDown ? "bad" : "neutral",
    },
    { label: "Rata-rata upload", value: fmtMbps(s.upAvg), sub: `min ${fmtMbps(s.upMin)} / maks ${fmtMbps(s.upMax)}` },
    { label: "Rata-rata ping", value: fmtMs(s.pingAvg), sub: `jitter ${fmtMs(s.jitterAvg)}${s.lossAvg != null ? ` - loss ${pct(s.lossAvg)}` : ""}` },
    {
      label: "Tes sukses",
      value: `${s.success}/${s.success + s.failed}`,
      sub: `tingkat sukses ${pct(s.successRate)}`,
      tone: s.failed ? (s.success ? "warn" : "bad") : s.success ? "good" : "neutral",
    },
  ];
}

export type SpeedBlockOptions = {
  timezone: string;
  from: Date;
  to: Date;
  /** Level heading per job (default 2). */
  headingLevel?: 1 | 2 | 3;
  /** Maks baris tabel "tes terbaru" (default 40). */
  maxRecent?: number;
};

/** Susun blok laporan untuk satu job speedtest. */
export function speedJobBlocks(j: SpeedReportJob, o: SpeedBlockOptions): ReportBlock[] {
  const tz = o.timezone;
  const lvl = o.headingLevel ?? 2;
  const s = summarize(j.rows);
  const blocks: ReportBlock[] = [];
  blocks.push({ type: "heading", text: `${safe(j.name)}${j.ssh ? ` (${safe(j.ssh.name)})` : ""}`, level: lvl });

  const servers = new Map<string, number>();
  for (const r of j.rows) {
    if (r.status !== "success" || !r.serverName) continue;
    const k = `${r.serverName}${r.serverLocation ? ` - ${r.serverLocation}` : ""}`;
    servers.set(k, (servers.get(k) ?? 0) + 1);
  }
  const topServers = [...servers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${safe(k, 60)} (${n}x)`).join("; ");
  const isps = [...new Set(j.rows.map((r) => r.isp).filter(Boolean))].slice(0, 3).map((x) => safe(x, 50)).join(", ");

  blocks.push({
    type: "kv",
    rows: [
      ["Server SSH", j.ssh ? `${safe(j.ssh.name)} (${safe(j.ssh.host)})` : "-"],
      ["Jadwal", `${scheduleText(j)} (${safe(j.timezone)})${j.enabled ? "" : " - nonaktif"}`],
      ["Tool", j.tool === "auto" ? `Otomatis${s.last?.tool ? ` (terakhir: ${TOOL_LABEL[s.last.tool] ?? s.last.tool})` : ""}` : (TOOL_LABEL[j.tool] ?? j.tool)],
      ["ISP / IP publik", `${isps || "-"}${s.last?.externalIp ? ` / ${safe(s.last.externalIp)}` : ""}`],
      ["Server uji", topServers || "-"],
      ["Jumlah tes", `${s.total} (sukses ${s.success}, gagal ${s.failed})`],
      ["Download persentil 10", `${fmtMbps(s.downP10)} (90% tes lebih cepat dari ini)`],
      ...(j.minDownloadMbps ? ([["Batas minimal download", fmtMbps(j.minDownloadMbps)]] as [string, string][]) : []),
    ],
  });

  if (!j.rows.length) {
    blocks.push({ type: "text", text: "Tidak ada hasil speedtest dalam periode ini.", muted: true });
    blocks.push({ type: "spacer" });
    return blocks;
  }

  blocks.push({ type: "stats", items: speedStatTiles(s, j.minDownloadMbps) });

  const ok = j.rows.filter((r) => r.status === "success");
  const daily = aggregateDaily(j.rows, tz, o.from, o.to);
  const days = daily.length;

  // 1) kecepatan tiap tes (bila tidak terlalu banyak titik), atau rata-rata harian
  if (ok.length >= 2 && ok.length <= 240) {
    blocks.push({
      type: "chart",
      chart: "line",
      title: "Kecepatan per tes",
      unit: "Mbps",
      labels: ok.map((r) => fmtDate(r.startedAt, tz)),
      series: [
        { name: "Download", color: SPEED_COLORS.download, values: ok.map((r) => r.downloadMbps) },
        { name: "Upload", color: SPEED_COLORS.upload, values: ok.map((r) => r.uploadMbps) },
      ],
    });
  }
  if (days >= 2) {
    blocks.push({
      type: "chart",
      chart: days <= 45 ? "bar" : "line",
      title: "Rata-rata kecepatan harian",
      unit: "Mbps",
      labels: daily.map((d) => shortDay(d.day)),
      series: [
        { name: "Download", color: SPEED_COLORS.download, values: daily.map((d) => d.downAvg) },
        { name: "Upload", color: SPEED_COLORS.upload, values: daily.map((d) => d.upAvg) },
      ],
    });
    blocks.push({
      type: "chart",
      chart: "line",
      title: "Tren latensi harian",
      unit: "ms",
      labels: daily.map((d) => shortDay(d.day)),
      series: [
        { name: "Ping", color: SPEED_COLORS.ping, values: daily.map((d) => d.pingAvg) },
        { name: "Jitter", color: SPEED_COLORS.jitter, values: daily.map((d) => d.jitterAvg) },
      ],
    });
  } else if (ok.length >= 2) {
    blocks.push({
      type: "chart",
      chart: "line",
      title: "Latensi per tes",
      unit: "ms",
      labels: ok.map((r) => fmtDate(r.startedAt, tz)),
      series: [
        { name: "Ping", color: SPEED_COLORS.ping, values: ok.map((r) => r.pingMs) },
        { name: "Jitter", color: SPEED_COLORS.jitter, values: ok.map((r) => r.jitterMs) },
      ],
    });
  }

  // 2) pola per jam (jam sibuk) — hanya bila tes tersebar di beberapa jam
  const hourly = aggregateHourly(j.rows, tz);
  if (hourly.filter((h) => h.tests > 0).length >= 3) {
    blocks.push({
      type: "chart",
      chart: "bar",
      title: "Rata-rata download per jam",
      unit: "Mbps",
      labels: hourly.map((h) => String(h.hour).padStart(2, "0")),
      series: [{ name: "Download", color: SPEED_COLORS.download, values: hourly.map((h) => h.downAvg) }],
      caption: `Jam dalam zona ${safe(tz)}. Jam tanpa tes dibiarkan kosong.`,
    });
  }

  // 3) packet loss (Ookla)
  if (daily.some((d) => d.lossAvg != null && d.lossAvg > 0)) {
    blocks.push({
      type: "chart",
      chart: "line",
      title: "Packet loss harian",
      unit: "%",
      labels: daily.map((d) => shortDay(d.day)),
      series: [{ name: "Packet loss", color: SPEED_COLORS.loss, values: daily.map((d) => d.lossAvg) }],
    });
  }

  // 4) tabel ringkasan harian
  const dailyRows = daily.filter((d) => d.tests > 0);
  if (dailyRows.length) {
    blocks.push({ type: "heading", text: "Ringkasan harian", level: 3 });
    blocks.push({
      type: "table",
      columns: [
        { label: "Tanggal", width: 1.5 },
        { label: "Tes", width: 0.7, align: "right" },
        { label: "Download rata2", width: 1.5, align: "right" },
        { label: "Download min", width: 1.4, align: "right" },
        { label: "Upload rata2", width: 1.4, align: "right" },
        { label: "Ping", width: 1, align: "right" },
        { label: "Jitter", width: 1, align: "right" },
        { label: "Gagal", width: 0.8, align: "right" },
      ],
      rows: dailyRows
        .slice()
        .reverse()
        .map((d) => [fmtDate(new Date(`${d.day}T12:00:00Z`), "UTC", false), d.tests, fmtMbps(d.downAvg), fmtMbps(d.downMin), fmtMbps(d.upAvg), fmtMs(d.pingAvg), fmtMs(d.jitterAvg), d.failed || "-"]),
      rowStates: dailyRows
        .slice()
        .reverse()
        .map((d) => (d.failed && d.failed === d.tests ? "down" : d.failed || (j.minDownloadMbps && d.downAvg != null && d.downAvg < j.minDownloadMbps) ? "partial" : null)),
    });
  }

  // 5) tes terbaru
  const recent = j.rows.slice(-(o.maxRecent ?? 40)).reverse();
  blocks.push({ type: "heading", text: "Tes terbaru", level: 3 });
  blocks.push({
    type: "table",
    columns: [
      { label: "Waktu", width: 1.6 },
      { label: "Download", width: 1.2, align: "right" },
      { label: "Upload", width: 1.2, align: "right" },
      { label: "Ping", width: 0.9, align: "right" },
      { label: "Jitter", width: 0.9, align: "right" },
      { label: "Server / keterangan", width: 3.4 },
    ],
    rows: recent.map((r) => [
      fmtDate(r.startedAt, tz),
      r.status === "success" ? fmtMbps(r.downloadMbps) : "GAGAL",
      fmtMbps(r.uploadMbps),
      fmtMs(r.pingMs),
      fmtMs(r.jitterMs),
      r.status === "success"
        ? safe(`${r.serverName ?? "-"}${r.serverLocation ? ` - ${r.serverLocation}` : ""}`, 70)
        : safe((r.error ?? "").split("\n")[0], 90) || "-",
    ]),
    rowStates: recent.map((r) => (r.status === "failed" ? "down" : null)),
  });
  if (j.rows.length > recent.length) blocks.push({ type: "text", text: `Ditampilkan ${recent.length} tes terbaru dari ${j.rows.length}.`, muted: true });
  blocks.push({ type: "spacer" });
  return blocks;
}

/** Perbandingan antar job (dipakai bila laporan memuat >1 job speedtest). */
export function speedCompareBlocks(jobs: SpeedReportJob[]): ReportBlock[] {
  if (jobs.length < 2) return [];
  const sums = jobs.map((j) => ({ j, s: summarize(j.rows) }));
  return [
    {
      type: "chart",
      chart: "bar",
      title: "Perbandingan rata-rata kecepatan antar server",
      unit: "Mbps",
      labels: sums.map(({ j }) => safe(j.ssh?.name ?? j.name, 18)),
      series: [
        { name: "Download", color: SPEED_COLORS.download, values: sums.map(({ s }) => s.downAvg) },
        { name: "Upload", color: SPEED_COLORS.upload, values: sums.map(({ s }) => s.upAvg) },
      ],
    },
    {
      type: "table",
      columns: [
        { label: "Job / server", width: 2.6 },
        { label: "Tes", width: 0.7, align: "right" },
        { label: "Download", width: 1.3, align: "right" },
        { label: "Upload", width: 1.3, align: "right" },
        { label: "Ping", width: 1, align: "right" },
        { label: "Jitter", width: 1, align: "right" },
        { label: "Sukses", width: 1, align: "right" },
      ],
      rows: sums.map(({ j, s }) => [
        `${safe(j.name, 30)}${j.ssh ? ` (${safe(j.ssh.name, 20)})` : ""}`,
        s.total,
        fmtMbps(s.downAvg),
        fmtMbps(s.upAvg),
        fmtMs(s.pingAvg),
        fmtMs(s.jitterAvg),
        pct(s.successRate),
      ]),
    },
  ];
}
