// Laporan riwayat SSH command: filter riwayat + penyusun blok PDF yang dipakai ulang
// oleh ekspor /sshcmd dan menu Laporan gabungan. Worker-safe (tanpa next/headers).
// PENTING: tidak ada cek izin di sini — pemanggil wajib memastikan jobIds milik tim user.
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { ReportBlock } from "./pdf/report";

export type RunStatusFilter = "success" | "failed" | "running";

export type RunFilter = {
  status?: RunStatusFilter;
  from?: Date;
  to?: Date;
};

function parseDate(v: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Baca filter riwayat dari query string: status, from, to (string tanggal ISO). */
export function parseRunFilter(sp: URLSearchParams): RunFilter {
  const s = sp.get("status");
  return {
    status: s === "success" || s === "failed" || s === "running" ? s : undefined,
    from: parseDate(sp.get("from")),
    to: parseDate(sp.get("to")),
  };
}

export function runWhere(jobId: string | { in: string[] }, f: RunFilter): Prisma.SshCommandRunWhereInput {
  return {
    jobId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.from || f.to ? { startedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
  };
}

export type SshCmdReportRun = {
  id: string;
  status: string;
  exitCode: number | null;
  output: string | null;
  error: string | null;
  startedAt: Date;
  endedAt: Date | null;
};

export type SshCmdReportJob = {
  id: string;
  name: string;
  command: string;
  scheduleType: string;
  timeAt: string | null;
  dayOn: number | null;
  cronExpr: string | null;
  timezone: string;
  enabled: boolean;
  ssh: { name: string; host: string; port: number; username: string } | null;
  stats: { total: number; success: number; failed: number; running: number };
  runs: SshCmdReportRun[];
  /** true bila jumlah run melebihi maxRunsPerJob (hanya yang terbaru yang dimuat). */
  truncated: boolean;
};

export type SshCmdReportOptions = RunFilter & {
  jobIds: string[];
  /** Batas run per job yang dimuat ke laporan (default 500). */
  maxRunsPerJob?: number;
  /** Sertakan output perintah per run (default true). */
  includeOutput?: boolean;
  /** Batas baris output per run di PDF (default 40). */
  maxOutputLines?: number;
  timezone?: string;
  /** Level heading per job (default 2). "Detail output" memakai level berikutnya (maks 3). */
  headingLevel?: 1 | 2 | 3;
};

export async function loadSshCmdReportData(opts: SshCmdReportOptions): Promise<SshCmdReportJob[]> {
  const maxRuns = Math.max(1, opts.maxRunsPerJob ?? 500);
  const jobs = await prisma.sshCommandJob.findMany({
    where: { id: { in: opts.jobIds } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      command: true,
      scheduleType: true,
      timeAt: true,
      dayOn: true,
      cronExpr: true,
      timezone: true,
      enabled: true,
      ssh: { select: { name: true, host: true, port: true, username: true } },
    },
  });

  return Promise.all(
    jobs.map(async (j) => {
      const where = runWhere(j.id, opts);
      const [grouped, runs] = await Promise.all([
        prisma.sshCommandRun.groupBy({ by: ["status"], where, _count: { _all: true } }),
        prisma.sshCommandRun.findMany({
          where,
          orderBy: { startedAt: "desc" },
          take: maxRuns,
          select: { id: true, status: true, exitCode: true, output: opts.includeOutput !== false, error: true, startedAt: true, endedAt: true },
        }),
      ]);
      const count = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;
      const total = grouped.reduce((n, g) => n + g._count._all, 0);
      return {
        ...j,
        stats: { total, success: count("success"), failed: count("failed"), running: count("running") },
        runs: runs.map((r) => ({ ...r, output: (r as { output?: string | null }).output ?? null })),
        truncated: total > runs.length,
      };
    }),
  );
}

const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export function scheduleLabel(j: Pick<SshCmdReportJob, "scheduleType" | "timeAt" | "dayOn" | "cronExpr">): string {
  if (j.scheduleType === "manual") return "Manual";
  if (j.scheduleType === "daily") return `Harian ${j.timeAt ?? ""}`.trim();
  if (j.scheduleType === "weekly") return `Mingguan, ${DAY_NAMES[j.dayOn ?? 0]} ${j.timeAt ?? ""}`.trim();
  if (j.scheduleType === "monthly") return `Bulanan, tgl ${j.dayOn ?? "?"} ${j.timeAt ?? ""}`.trim();
  return `Cron: ${j.cronExpr ?? ""}`;
}

export function fmtDateTime(d: Date | null | undefined, timezone = "Asia/Jakarta"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

export function fmtDuration(start: Date, end: Date | null): string {
  if (!end) return "—";
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} dtk`;
  const m = Math.floor(s / 60);
  return `${m} mnt ${s % 60} dtk`;
}

export function periodLabel(f: RunFilter, timezone = "Asia/Jakarta"): string {
  if (!f.from && !f.to) return "Semua riwayat";
  return `${f.from ? fmtDateTime(f.from, timezone) : "awal"} s/d ${f.to ? fmtDateTime(f.to, timezone) : "sekarang"}`;
}

function firstLine(s: string | null | undefined, max = 90): string {
  const line = (s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const STATUS_LABEL: Record<string, string> = { success: "Sukses", failed: "Gagal", running: "Berjalan" };

/** Blok laporan untuk sekumpulan job (sudah dimuat). */
export function sshCmdJobsToBlocks(jobs: SshCmdReportJob[], opts: Pick<SshCmdReportOptions, "includeOutput" | "maxOutputLines" | "timezone" | "status" | "from" | "to" | "headingLevel">): ReportBlock[] {
  const tz = opts.timezone ?? "Asia/Jakarta";
  const hJob = opts.headingLevel ?? 2;
  const hSub = (hJob >= 3 ? 3 : hJob + 1) as 1 | 2 | 3;
  const blocks: ReportBlock[] = [];
  if (jobs.length === 0) {
    blocks.push({ type: "text", text: "Tidak ada job SSH command yang dipilih.", muted: true });
    return blocks;
  }

  jobs.forEach((j, idx) => {
    if (idx > 0) blocks.push({ type: "spacer" });
    const rate = j.stats.success + j.stats.failed > 0 ? `${((j.stats.success / (j.stats.success + j.stats.failed)) * 100).toFixed(1)}%` : "—";
    blocks.push({ type: "heading", text: `SSH Command: ${j.name}`, level: hJob });
    blocks.push({
      type: "kv",
      rows: [
        ["Server SSH", j.ssh ? `${j.ssh.name} (${j.ssh.username}@${j.ssh.host}:${j.ssh.port})` : "—"],
        ["Perintah", j.command],
        ["Jadwal", `${scheduleLabel(j)}${j.enabled ? "" : " (nonaktif)"}`],
        ["Periode", periodLabel(opts, tz)],
        ...(opts.status ? ([["Filter status", STATUS_LABEL[opts.status] ?? opts.status]] as [string, string][]) : []),
        ["Total eksekusi", String(j.stats.total)],
        ["Sukses / Gagal / Berjalan", `${j.stats.success} / ${j.stats.failed} / ${j.stats.running}`],
        ["Tingkat keberhasilan", rate],
      ],
    });

    if (j.runs.length === 0) {
      blocks.push({ type: "text", text: "Tidak ada riwayat eksekusi pada periode ini.", muted: true });
      return;
    }
    if (j.truncated) {
      blocks.push({ type: "text", text: `Menampilkan ${j.runs.length} eksekusi terbaru dari ${j.stats.total}.`, muted: true });
    }

    blocks.push({
      type: "table",
      columns: [
        { label: "#", width: 0.06, align: "right" },
        { label: "Mulai", width: 0.24 },
        { label: "Durasi", width: 0.12 },
        { label: "Status", width: 0.1 },
        { label: "Exit", width: 0.07, align: "right" },
        { label: "Keterangan", width: 0.41 },
      ],
      rows: j.runs.map((r, i) => [
        i + 1,
        fmtDateTime(r.startedAt, tz),
        fmtDuration(r.startedAt, r.endedAt),
        STATUS_LABEL[r.status] ?? r.status,
        r.exitCode,
        r.error ? firstLine(r.error) : firstLine(r.output),
      ]),
      rowStates: j.runs.map((r) => (r.status === "failed" ? "down" : null)),
    });

    if (opts.includeOutput !== false) {
      const withDetail = j.runs.filter((r) => r.output || r.error);
      if (withDetail.length > 0) blocks.push({ type: "heading", text: "Detail output", level: hSub });
      withDetail.forEach((r) => {
        const i = j.runs.indexOf(r) + 1;
        blocks.push({ type: "text", text: `#${i} · ${fmtDateTime(r.startedAt, tz)} · ${STATUS_LABEL[r.status] ?? r.status}${r.exitCode != null ? ` · exit ${r.exitCode}` : ""}` });
        if (r.error) blocks.push({ type: "text", text: `Error: ${r.error}` });
        if (r.output) blocks.push({ type: "code", text: r.output, maxLines: opts.maxOutputLines ?? 40 });
      });
    }
  });
  return blocks;
}

/** Muat data + susun blok laporan riwayat SSH command. Dipakai juga oleh menu Laporan. */
export async function buildSshCmdReportBlocks(opts: SshCmdReportOptions): Promise<ReportBlock[]> {
  const jobs = await loadSshCmdReportData(opts);
  return sshCmdJobsToBlocks(jobs, opts);
}
