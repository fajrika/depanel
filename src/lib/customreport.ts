// Laporan gabungan (menu "Laporan"): menyusun satu laporan utuh dari item yang
// dipilih di menu lain — server Depa, koneksi SSH, SSH script, backup DB, backup
// file, health check (URL) dan health app (SSH). Hasilnya berupa ReportBlock[]
// yang dipakai bersama oleh preview HTML dan PDF (src/lib/pdf/report.ts).
//
// Izin dicek ulang setiap kali laporan dibuat, memakai izin user yang membuka
// laporan (bukan pembuatnya): item yang tidak boleh dia lihat dilewati.
import "server-only";
import { prisma } from "./db";
import { isStaff, membershipOf, featureAllowed } from "./team";
import type { ReportBlock, ReportSpec } from "./pdf/report";
import { buildHealthCheckReportBlocks } from "./healthcheck-report";
import { buildSshCmdReportBlocks } from "./sshcmd-report";

/* ------------------------------------------------------------------ */
/* Definisi item                                                        */
/* ------------------------------------------------------------------ */

export const ITEM_KINDS = [
  "servers",
  "sshConns",
  "sshCmdJobs",
  "dbJobs",
  "dirCloneJobs",
  "healthChecks",
  "sshHealthChecks",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type ReportItems = Record<ItemKind, string[]>;

export const KIND_TITLE: Record<ItemKind, string> = {
  servers: "Server Depa",
  sshConns: "Server SSH",
  sshCmdJobs: "SSH Script",
  dbJobs: "Backup Database",
  dirCloneJobs: "Backup File",
  healthChecks: "Health Check",
  sshHealthChecks: "Health App",
};

/** Parse kolom JSON `items` dengan aman (data lama/rusak → kosong). */
export function parseItems(raw: string | null | undefined): ReportItems {
  let obj: Record<string, unknown> = {};
  try {
    const v = JSON.parse(raw || "{}");
    if (v && typeof v === "object") obj = v as Record<string, unknown>;
  } catch {
    /* abaikan */
  }
  const out = {} as ReportItems;
  for (const k of ITEM_KINDS) {
    const arr = obj[k];
    out[k] = Array.isArray(arr) ? [...new Set(arr.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, 200) : [];
  }
  return out;
}

export function countItems(items: ReportItems): number {
  return ITEM_KINDS.reduce((n, k) => n + items[k].length, 0);
}

/* ------------------------------------------------------------------ */
/* Izin                                                                 */
/* ------------------------------------------------------------------ */

type Access = {
  staff: boolean;
  memberId: string;
  ssh: boolean;
  backupDb: boolean;
  infra: boolean;
};

export async function accessFor(userId: string, teamId: string): Promise<Access | null> {
  const m = await membershipOf(userId, teamId);
  if (!m) return null;
  return {
    staff: isStaff(m.role),
    memberId: m.id,
    ssh: featureAllowed(m, "ssh"),
    backupDb: featureAllowed(m, "backupDb"),
    infra: featureAllowed(m, "infra"),
  };
}

function kindAllowed(a: Access, kind: ItemKind): boolean {
  switch (kind) {
    case "servers":
      return true; // visibilitas per server dicek terpisah
    case "sshConns":
    case "sshCmdJobs":
    case "sshHealthChecks":
      return a.ssh;
    case "dbJobs":
    case "dirCloneJobs":
      return a.backupDb;
    case "healthChecks":
      return a.infra;
  }
}

function serverWhere(teamId: string, a: Access) {
  return a.staff
    ? { account: { teamId }, isActive: true }
    : { account: { teamId }, isActive: true, hiddenFor: { none: { memberId: a.memberId } } };
}

/** Pilihan item yang boleh dipakai user di tim aktif (untuk form builder). */
export async function listOptions(teamId: string, a: Access) {
  const [servers, sshConns, sshCmdJobs, dbJobs, dirCloneJobs, healthChecks, sshHealthChecks] = await Promise.all([
    prisma.server.findMany({
      where: serverWhere(teamId, a),
      orderBy: [{ accountId: "asc" }, { sortOrder: "asc" }, { hostname: "asc" }],
      select: { id: true, hostname: true, ipAddress: true, status: true, account: { select: { name: true } } },
    }),
    a.ssh
      ? prisma.sshConnection.findMany({
          where: { teamId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, host: true, group: { select: { name: true } } },
        })
      : [],
    a.ssh
      ? prisma.sshCommandJob.findMany({
          where: { teamId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, lastStatus: true, ssh: { select: { name: true } } },
        })
      : [],
    a.backupDb
      ? prisma.dbBackupJob.findMany({
          where: { connection: { teamId } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, lastStatus: true, connection: { select: { name: true } } },
        })
      : [],
    a.backupDb
      ? prisma.dirCloneJob.findMany({
          where: { teamId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, lastStatus: true, sourcePath: true, sourceSsh: { select: { name: true } } },
        })
      : [],
    a.infra
      ? prisma.healthCheck.findMany({
          where: { teamId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, url: true, lastStatus: true, group: { select: { name: true } } },
        })
      : [],
    a.ssh
      ? prisma.sshHealthCheck.findMany({
          where: { teamId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, lastStatus: true, ssh: { select: { name: true } } },
        })
      : [],
  ]);

  type Opt = { id: string; label: string; sub?: string | null; status?: string | null; group?: string | null };
  const out: Record<ItemKind, Opt[]> = {
    servers: servers.map((s) => ({ id: s.id, label: s.hostname, sub: s.ipAddress, status: s.status, group: s.account.name })),
    sshConns: sshConns.map((s) => ({ id: s.id, label: s.name, sub: s.host, group: s.group?.name ?? null })),
    sshCmdJobs: sshCmdJobs.map((j) => ({ id: j.id, label: j.name, sub: j.ssh.name, status: j.lastStatus })),
    dbJobs: dbJobs.map((j) => ({ id: j.id, label: j.name, sub: j.connection.name, status: j.lastStatus })),
    dirCloneJobs: dirCloneJobs.map((j) => ({ id: j.id, label: j.name, sub: `${j.sourceSsh.name}:${j.sourcePath}`, status: j.lastStatus })),
    healthChecks: healthChecks.map((h) => ({ id: h.id, label: h.name, sub: h.url, status: h.lastStatus, group: h.group?.name ?? null })),
    sshHealthChecks: sshHealthChecks.map((h) => ({ id: h.id, label: h.name, sub: h.ssh.name, status: h.lastStatus })),
  };
  return out;
}

/* ------------------------------------------------------------------ */
/* Format                                                               */
/* ------------------------------------------------------------------ */

const DAY = 24 * 60 * 60 * 1000;

/** Font standar PDF hanya mendukung Latin-1; ganti karakter lain dengan "?". */
function safe(s: string | null | undefined, max = 0): string {
  let v = (s ?? "").replace(/[\r\t]/g, " ").replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "?");
  if (max && v.length > max) v = v.slice(0, max - 3) + "...";
  return v;
}

function firstLine(s: string | null | undefined, max = 90): string {
  const line = (s ?? "").split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return safe(line, max);
}

function fmtDate(d: Date | null | undefined, tz: string, withTime = true): string {
  if (!d) return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: tz,
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/** Kunci hari lokal YYYY-MM-DD untuk zona waktu tertentu. */
function dayKey(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "-";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}

function fmtDur(start: Date, end: Date | null | undefined): string {
  if (!end) return "-";
  const s = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  if (s < 60) return `${s} dtk`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt ${s % 60} dtk`;
  return `${Math.floor(m / 60)} jam ${m % 60} mnt`;
}

function pct(n: number | null | undefined): string {
  return n == null ? "-" : `${(Math.round(n * 10) / 10).toLocaleString("id-ID")}%`;
}

function avg(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function max(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? Math.max(...v) : null;
}

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

function statusText(s: string | null | undefined): string {
  switch (s) {
    case "success":
      return "Sukses";
    case "failed":
      return "Gagal";
    case "running":
      return "Berjalan";
    case "up":
    case "healthy":
      return "Up";
    case "down":
      return "Down";
    case "stopped":
      return "Mati";
    default:
      return s ? safe(s) : "-";
  }
}

type DayState = "up" | "down" | "partial" | "none";

/** Strip status per hari (maks 31 hari terakhir dari periode). */
function dailyStrip(
  samples: { at: Date; ok: boolean }[],
  from: Date,
  to: Date,
  tz: string,
): { label?: string; state: DayState }[] {
  const byDay = new Map<string, { up: number; total: number }>();
  for (const s of samples) {
    const k = dayKey(s.at, tz);
    const b = byDay.get(k) ?? { up: 0, total: 0 };
    b.total++;
    if (s.ok) b.up++;
    byDay.set(k, b);
  }
  const start = Math.max(from.getTime(), to.getTime() - 30 * DAY);
  const out: { label?: string; state: DayState }[] = [];
  const seen = new Set<string>();
  for (let t = start; t <= to.getTime() + DAY - 1; t += DAY) {
    const k = dayKey(new Date(Math.min(t, to.getTime())), tz);
    if (seen.has(k)) continue;
    seen.add(k);
    const b = byDay.get(k);
    const state: DayState = !b || !b.total ? "none" : b.up === b.total ? "up" : b.up === 0 ? "down" : "partial";
    out.push({ label: k.slice(8, 10), state });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Bagian-bagian laporan                                                */
/* ------------------------------------------------------------------ */

type Ctx = { teamId: string; access: Access; from: Date; to: Date; tz: string };
type SummaryRow = [string, string, string, string];

async function serverSection(ctx: Ctx, ids: string[], summary: SummaryRow[]): Promise<ReportBlock[]> {
  const { teamId, access, from, to, tz } = ctx;
  const servers = await prisma.server.findMany({
    where: { id: { in: ids }, ...serverWhere(teamId, access) },
    include: { account: { select: { name: true } } },
  });
  const order = new Map(ids.map((id, i) => [id, i]));
  servers.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const blocks: ReportBlock[] = [];
  for (const s of servers) {
    const [samples, logs] = await Promise.all([
      prisma.metricSample.findMany({
        where: { serverId: s.id, at: { gte: from, lte: to } },
        orderBy: { at: "asc" },
        select: { at: true, status: true, cpu: true, memPct: true },
      }),
      prisma.activityLog.findMany({
        where: { serverId: s.id, createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { user: { select: { name: true } } },
      }),
    ]);
    const up = samples.filter((x) => x.status === "running").length;
    const uptime = samples.length ? (up / samples.length) * 100 : null;
    summary.push([KIND_TITLE.servers, safe(s.hostname), statusText(s.status), `Uptime ${pct(uptime)}`]);

    blocks.push({ type: "heading", text: safe(s.hostname), level: 3 });
    blocks.push({
      type: "kv",
      rows: [
        ["Akun", safe(s.account.name)],
        ["Status saat ini", statusText(s.status)],
        ["IP", safe(s.ipAddress) || "-"],
        ["Lokasi / tier", `${safe(s.location) || "-"} / ${safe(s.tier) || "-"}`],
        ["Spesifikasi", `${s.cpu ?? "-"} vCPU, ${s.memoryMb ? Math.round(s.memoryMb / 1024) : "-"} GB RAM, ${s.storageGb ?? "-"} GB disk`],
        ["Produksi", s.isProduction ? "Ya" : "Tidak"],
        ["Uptime periode", `${pct(uptime)} (${samples.length} sampel)`],
        ["CPU rata-rata / puncak", `${pct(avg(samples.map((x) => x.cpu)))} / ${pct(max(samples.map((x) => x.cpu)))}`],
        ["RAM rata-rata / puncak", `${pct(avg(samples.map((x) => x.memPct)))} / ${pct(max(samples.map((x) => x.memPct)))}`],
      ],
    });
    if (samples.length) {
      blocks.push({ type: "statusStrip", items: dailyStrip(samples.map((x) => ({ at: x.at, ok: x.status === "running" })), from, to, tz) });
    }
    if (logs.length) {
      blocks.push({ type: "text", text: "Aktivitas dalam periode (maks 30 terbaru):", muted: true });
      blocks.push({
        type: "table",
        columns: [{ label: "Waktu", width: 2.2 }, { label: "Aksi", width: 1.5 }, { label: "Oleh", width: 1.5 }, { label: "Status", width: 1.1 }, { label: "Pesan", width: 4 }],
        rows: logs.map((l) => [
          fmtDate(l.createdAt, tz),
          safe(l.action),
          l.user?.name ? safe(l.user.name, 20) : l.source === "scheduler" ? "Penjadwal" : "-",
          statusText(l.status),
          firstLine(l.message, 70) || "-",
        ]),
      });
    }
    blocks.push({ type: "spacer" });
  }
  return blocks;
}

async function sshConnSection(ctx: Ctx, ids: string[], summary: SummaryRow[]): Promise<ReportBlock[]> {
  const { teamId, from, to, tz } = ctx;
  const conns = await prisma.sshConnection.findMany({
    where: { id: { in: ids }, teamId },
    select: { id: true, name: true, host: true, port: true, username: true, group: { select: { name: true } } },
  });
  const order = new Map(ids.map((id, i) => [id, i]));
  conns.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const blocks: ReportBlock[] = [];
  for (const c of conns) {
    const [samples, latest] = await Promise.all([
      prisma.sshMetricSample.findMany({
        where: { sshId: c.id, at: { gte: from, lte: to } },
        orderBy: { at: "asc" },
        select: { at: true, ok: true, cpu: true, memPct: true, load1: true },
      }),
      prisma.sshMetricSample.findFirst({ where: { sshId: c.id, ok: true }, orderBy: { at: "desc" } }),
    ]);
    const up = samples.filter((x) => x.ok).length;
    const avail = samples.length ? (up / samples.length) * 100 : null;
    summary.push([KIND_TITLE.sshConns, safe(c.name), samples.length ? (samples[samples.length - 1].ok ? "Up" : "Down") : "-", `Tersedia ${pct(avail)}`]);

    blocks.push({ type: "heading", text: `${safe(c.name)} (${safe(c.host)})`, level: 3 });
    const rows: [string, string][] = [
      ["Alamat", `${safe(c.username)}@${safe(c.host)}:${c.port}`],
      ["Grup", safe(c.group?.name) || "-"],
      ["Ketersediaan periode", `${pct(avail)} (${samples.length} sampel)`],
      ["CPU rata-rata / puncak", `${pct(avg(samples.map((x) => x.cpu)))} / ${pct(max(samples.map((x) => x.cpu)))}`],
      ["RAM rata-rata / puncak", `${pct(avg(samples.map((x) => x.memPct)))} / ${pct(max(samples.map((x) => x.memPct)))}`],
    ];
    if (latest) {
      rows.push(
        ["Sampel terakhir", fmtDate(latest.at, tz)],
        ["Hostname / OS", `${safe(latest.hostname) || "-"} / ${safe(latest.osName) || "-"}`],
        ["Kernel", safe(latest.kernel) || "-"],
        ["CPU core", latest.cpuCores != null ? String(latest.cpuCores) : "-"],
        ["RAM", latest.memTotalMb ? `${fmtBytes((latest.memUsedMb ?? 0) * 1024 * 1024)} / ${fmtBytes(latest.memTotalMb * 1024 * 1024)}` : "-"],
        ["Load (1/5/15)", [latest.load1, latest.load5, latest.load15].map((x) => (x == null ? "-" : x.toFixed(2))).join(" / ")],
        ["Uptime server", latest.uptimeSec != null ? `${Math.floor(latest.uptimeSec / 86400)} hari ${Math.floor((latest.uptimeSec % 86400) / 3600)} jam` : "-"],
      );
    }
    blocks.push({ type: "kv", rows });
    if (samples.length) blocks.push({ type: "statusStrip", items: dailyStrip(samples, from, to, tz) });

    if (latest?.disk) {
      try {
        const disks = JSON.parse(latest.disk) as { mount: string; sizeMb: number; usedMb: number; pct: number }[];
        if (Array.isArray(disks) && disks.length) {
          blocks.push({
            type: "table",
            columns: [{ label: "Mount", width: 3 }, { label: "Terpakai", align: "right", width: 1.3 }, { label: "Ukuran", align: "right", width: 1.3 }, { label: "%", align: "right", width: 0.8 }],
            rows: disks.slice(0, 15).map((d) => [safe(d.mount, 50), fmtBytes(d.usedMb * 1024 * 1024), fmtBytes(d.sizeMb * 1024 * 1024), pct(d.pct)]),
          });
        }
      } catch {
        /* abaikan */
      }
    }
    if (latest?.failedSvcs) {
      try {
        const f = JSON.parse(latest.failedSvcs) as string[];
        if (Array.isArray(f) && f.length) blocks.push({ type: "text", text: `Service gagal: ${f.map((x) => safe(x)).join(", ")}` });
      } catch {
        /* abaikan */
      }
    }
    blocks.push({ type: "spacer" });
  }
  return blocks;
}

async function runJobSection(
  ctx: Ctx,
  kind: "dbJobs" | "dirCloneJobs",
  ids: string[],
  summary: SummaryRow[],
): Promise<ReportBlock[]> {
  const { teamId, from, to, tz } = ctx;
  type JobInfo = { id: string; name: string; kv: [string, string][]; lastStatus: string | null };
  type RunInfo = { status: string; sizeBytes: number | null; message: string | null; location: string | null; startedAt: Date; endedAt: Date | null };
  const jobs: JobInfo[] = [];
  if (kind === "dbJobs") {
    const rows = await prisma.dbBackupJob.findMany({
      where: { id: { in: ids }, connection: { teamId } },
      include: { connection: { select: { name: true, host: true } }, dest: { select: { name: true } } },
    });
    for (const j of rows) {
      let dbs: string[] = [];
      try {
        dbs = JSON.parse(j.databases);
      } catch {
        /* abaikan */
      }
      jobs.push({
        id: j.id,
        name: j.name,
        lastStatus: j.lastStatus,
        kv: [
          ["Koneksi", `${safe(j.connection.name)} (${safe(j.connection.host)})`],
          ["Database", Array.isArray(dbs) && dbs.length ? safe(dbs.join(", "), 200) : "-"],
          ["Jadwal", `${scheduleText(j)} (${safe(j.timezone)})${j.enabled ? "" : " - nonaktif"}`],
          ["Tujuan", `${safe(j.destType).toUpperCase()}${j.dest ? ` - ${safe(j.dest.name)}` : ""}${j.destPath ? ` : ${safe(j.destPath, 80)}` : ""}`],
          ["Kompresi / retensi", `${safe(j.compression)} / ${j.retention ? `${j.retention} terakhir` : "simpan semua"}`],
        ],
      });
    }
  } else {
    const rows = await prisma.dirCloneJob.findMany({
      where: { id: { in: ids }, teamId },
      include: { sourceSsh: { select: { name: true } }, destSsh: { select: { name: true } } },
    });
    for (const j of rows) {
      jobs.push({
        id: j.id,
        name: j.name,
        lastStatus: j.lastStatus,
        kv: [
          ["Sumber", `${safe(j.sourceSsh.name)}:${safe(j.sourcePath, 80)}`],
          ["Tujuan", `${safe(j.destType).toUpperCase()}${j.destSsh ? ` - ${safe(j.destSsh.name)}` : ""}${j.destPath ? ` : ${safe(j.destPath, 80)}` : ""}`],
          ["Jadwal", `${scheduleText(j)} (${safe(j.timezone)})${j.enabled ? "" : " - nonaktif"}`],
          ["Retensi", j.retention ? `${j.retention} terakhir` : "simpan semua"],
        ],
      });
    }
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  jobs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const blocks: ReportBlock[] = [];
  const LIMIT = 100;
  for (const j of jobs) {
    const where = { jobId: j.id, startedAt: { gte: from, lte: to } };
    const sel = { status: true, sizeBytes: true, message: true, location: true, startedAt: true, endedAt: true } as const;
    const [runs, total, ok, failed]: [RunInfo[], number, number, number] =
      kind === "dbJobs"
        ? await Promise.all([
            prisma.dbBackupRun.findMany({ where, orderBy: { startedAt: "desc" }, take: LIMIT, select: sel }),
            prisma.dbBackupRun.count({ where }),
            prisma.dbBackupRun.count({ where: { ...where, status: "success" } }),
            prisma.dbBackupRun.count({ where: { ...where, status: "failed" } }),
          ])
        : await Promise.all([
            prisma.dirCloneRun.findMany({ where, orderBy: { startedAt: "desc" }, take: LIMIT, select: sel }),
            prisma.dirCloneRun.count({ where }),
            prisma.dirCloneRun.count({ where: { ...where, status: "success" } }),
            prisma.dirCloneRun.count({ where: { ...where, status: "failed" } }),
          ]);
    const rate = total ? (ok / total) * 100 : null;
    const lastOk = runs.find((r) => r.status === "success");
    summary.push([KIND_TITLE[kind], safe(j.name), statusText(j.lastStatus), `Sukses ${ok}/${total}`]);

    blocks.push({ type: "heading", text: safe(j.name), level: 3 });
    blocks.push({
      type: "kv",
      rows: [
        ...j.kv,
        ["Status terakhir", statusText(j.lastStatus)],
        ["Run dalam periode", `${total} (sukses ${ok}, gagal ${failed}) - tingkat sukses ${pct(rate)}`],
        ["Backup sukses terakhir", lastOk ? `${fmtDate(lastOk.startedAt, tz)} - ${fmtBytes(lastOk.sizeBytes)}` : "-"],
      ],
    });
    if (runs.length) {
      blocks.push({
        type: "table",
        columns: [
          { label: "Mulai", width: 2.2 },
          { label: "Status", width: 1.1 },
          { label: "Durasi", width: 1.4 },
          { label: "Ukuran", width: 1.2, align: "right" },
          { label: "Keterangan", width: 4 },
        ],
        rows: runs.map((r) => [
          fmtDate(r.startedAt, tz),
          statusText(r.status),
          fmtDur(r.startedAt, r.endedAt),
          fmtBytes(r.sizeBytes),
          r.status === "failed" ? firstLine(r.message, 80) || "-" : firstLine(r.location, 80) || firstLine(r.message, 80) || "-",
        ]),
        rowStates: runs.map((r) => (r.status === "failed" ? "down" : null)),
      });
      if (total > runs.length) blocks.push({ type: "text", text: `Ditampilkan ${runs.length} run terbaru dari ${total}.`, muted: true });
    } else {
      blocks.push({ type: "text", text: "Tidak ada run dalam periode ini.", muted: true });
    }
    blocks.push({ type: "spacer" });
  }
  return blocks;
}

async function sshHealthSection(ctx: Ctx, ids: string[], summary: SummaryRow[]): Promise<ReportBlock[]> {
  const { teamId, tz } = ctx;
  const rows = await prisma.sshHealthCheck.findMany({
    where: { id: { in: ids }, teamId },
    include: { ssh: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  if (!rows.length) return [];
  for (const h of rows) summary.push([KIND_TITLE.sshHealthChecks, safe(h.name), statusText(h.lastStatus), `Cek ${fmtDate(h.lastRunAt, tz)}`]);
  return [
    { type: "text", text: "Health App hanya menyimpan status terakhir (tanpa riwayat).", muted: true },
    {
      type: "table",
      columns: [{ label: "Nama", width: 2 }, { label: "Server", width: 1.6 }, { label: "Status", width: 0.9 }, { label: "Cek terakhir", width: 2 }, { label: "Perintah / output", width: 4 }],
      rows: rows.map((h) => [
        safe(h.name, 40),
        safe(h.ssh.name, 30),
        statusText(h.lastStatus),
        fmtDate(h.lastRunAt, tz),
        `${safe(h.command, 60)}${h.lastOutput ? ` -> ${firstLine(h.lastOutput, 60)}` : ""}`,
      ]),
    },
    { type: "spacer" },
  ];
}

/* ------------------------------------------------------------------ */
/* Laporan utuh                                                         */
/* ------------------------------------------------------------------ */

export type BuildInput = {
  teamId: string;
  teamName: string;
  userId: string;
  name: string;
  description?: string | null;
  items: ReportItems;
  from: Date;
  to: Date;
  timezone: string;
};

/** Susun ReportSpec laporan gabungan. Item tanpa izin/terhapus dilewati diam-diam. */
export async function buildCustomReport(input: BuildInput): Promise<ReportSpec> {
  const access = await accessFor(input.userId, input.teamId);
  if (!access) throw new Error("Bukan anggota tim");
  const tz = input.timezone || "Asia/Jakarta";
  const ctx: Ctx = { teamId: input.teamId, access, from: input.from, to: input.to, tz };
  const items = input.items;
  const summary: SummaryRow[] = [];
  const sections: { title: string; blocks: ReportBlock[] }[] = [];
  const skipped: string[] = [];

  for (const kind of ITEM_KINDS) {
    const ids = items[kind];
    if (!ids.length) continue;
    if (!kindAllowed(access, kind)) {
      skipped.push(KIND_TITLE[kind]);
      continue;
    }
    let blocks: ReportBlock[] = [];
    switch (kind) {
      case "servers":
        blocks = await serverSection(ctx, ids, summary);
        break;
      case "sshConns":
        blocks = await sshConnSection(ctx, ids, summary);
        break;
      case "sshCmdJobs": {
        // filter ke tim aktif dulu: builder bersama tidak mengecek izin
        const own = await prisma.sshCommandJob.findMany({
          where: { id: { in: ids }, teamId: input.teamId },
          select: { id: true, name: true, lastStatus: true },
        });
        if (!own.length) break;
        const okIds = ids.filter((id) => own.some((j) => j.id === id));
        for (const j of own) summary.push([KIND_TITLE.sshCmdJobs, safe(j.name), statusText(j.lastStatus), "-"]);
        blocks = await buildSshCmdReportBlocks({ jobIds: okIds, from: input.from, to: input.to, timezone: tz, includeOutput: false });
        break;
      }
      case "dbJobs":
      case "dirCloneJobs":
        blocks = await runJobSection(ctx, kind, ids, summary);
        break;
      case "healthChecks": {
        const own = await prisma.healthCheck.findMany({
          where: { id: { in: ids }, teamId: input.teamId },
          select: { id: true, name: true, lastStatus: true, lastLatencyMs: true },
        });
        if (!own.length) break;
        const okIds = ids.filter((id) => own.some((h) => h.id === id));
        for (const h of own) summary.push([KIND_TITLE.healthChecks, safe(h.name), statusText(h.lastStatus), h.lastLatencyMs != null ? `${h.lastLatencyMs} ms` : "-"]);
        blocks = await buildHealthCheckReportBlocks(okIds, { from: input.from, to: input.to }, { timezone: tz });
        break;
      }
      case "sshHealthChecks":
        blocks = await sshHealthSection(ctx, ids, summary);
        break;
    }
    if (blocks.length) sections.push({ title: KIND_TITLE[kind], blocks });
  }

  const head: ReportBlock[] = [
    {
      type: "kv",
      rows: [
        ["Tim", safe(input.teamName)],
        ["Periode", `${fmtDate(input.from, tz)} s/d ${fmtDate(input.to, tz)} (${safe(tz)})`],
        ["Jumlah item", String(summary.length)],
        ...(input.description ? ([["Keterangan", safe(input.description, 300)]] as [string, string][]) : []),
      ],
    },
  ];
  if (summary.length) {
    head.push({ type: "heading", text: "Ringkasan", level: 2 });
    head.push({
      type: "table",
      columns: [{ label: "Kategori", width: 1.6 }, { label: "Item", width: 3.2 }, { label: "Status", width: 1 }, { label: "Indikator", width: 1.8 }],
      rows: summary,
      rowStates: summary.map((r) => (r[2] === "Down" || r[2] === "Gagal" ? "down" : null)),
    });
  } else {
    head.push({ type: "text", text: "Tidak ada item yang bisa ditampilkan (item terhapus atau Anda tidak punya izin).", muted: true });
  }
  if (skipped.length) {
    head.push({ type: "text", text: `Bagian dilewati karena izin Anda: ${skipped.join(", ")}.`, muted: true });
  }

  const blocks: ReportBlock[] = [...head];
  for (const s of sections) {
    blocks.push({ type: "spacer", size: 14 });
    blocks.push({ type: "heading", text: s.title, level: 1 });
    blocks.push(...s.blocks);
  }

  return {
    title: safe(input.name),
    subtitle: `Laporan gabungan - ${safe(input.teamName)}`,
    timezone: tz,
    generatedAt: new Date(),
    blocks,
  };
}

/** Hitung periode dari query (?from=YYYY-MM-DD&to=YYYY-MM-DD) atau rangeDays. */
export function resolveRange(searchParams: URLSearchParams, rangeDays: number): { from: Date; to: Date } {
  const now = new Date();
  const f = searchParams.get("from");
  const t = searchParams.get("to");
  const re = /^\d{4}-\d{2}-\d{2}$/;
  let from = new Date(now.getTime() - Math.max(1, rangeDays) * DAY);
  let to = now;
  // tanggal ditafsirkan sebagai WIB (Asia/Jakarta, UTC+7) — zona default panel
  if (f && re.test(f)) from = new Date(`${f}T00:00:00+07:00`);
  if (t && re.test(t)) to = new Date(`${t}T23:59:59+07:00`);
  if (to > now) to = now;
  if (from >= to) from = new Date(to.getTime() - DAY);
  if (to.getTime() - from.getTime() > 366 * DAY) from = new Date(to.getTime() - 366 * DAY);
  return { from, to };
}
