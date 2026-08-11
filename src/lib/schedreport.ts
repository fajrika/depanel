// Engine laporan terjadwal: ringkasan otomatis (biaya/aktivitas/backup) yang
// dikirim ke channel notifikasi tim. Worker-safe (tanpa next/headers).
import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import { depaClient } from "./depa";
import { jobIsDue } from "./dbbackup";
import { notifyTeam } from "./notify";

/** Bila job baru saja berjalan (< 5 menit), lewati agar tidak terkirim dobel. */
const DEDUP_MS = 5 * 60 * 1000;

/** Format rupiah manual tanpa library: Rp1.234.567 (bulat, tanpa desimal). */
function fmtRupiah(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(Math.round(n));
  const s = String(abs);
  const parts: string[] = [];
  for (let i = s.length; i > 0; i -= 3) {
    parts.unshift(s.slice(Math.max(0, i - 3), i));
  }
  return `${neg ? "-" : ""}Rp${parts.join(".")}`;
}

function fmtStamp(d: Date): string {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "short", timeStyle: "short" }).format(d);
}

/** Ringkasan saldo per akun depa tim. Satu akun gagal tidak membatalkan yang lain. */
async function genCostReport(teamId: string): Promise<string> {
  const accounts = await prisma.depaAccount.findMany({
    where: { teamId, active: true },
    orderBy: { name: "asc" },
  });
  if (accounts.length === 0) return "💰 Laporan saldo\n\nTidak ada akun depa aktif.";

  const lines = ["💰 Laporan saldo", ""];
  for (const acc of accounts) {
    try {
      const key = decryptSecret(acc.apiKeyEnc);
      const summary = (await depaClient(key).billingSummary()) as Record<string, unknown>;
      const balance = Number(summary?.actual_balance ?? 0);
      lines.push(`• ${acc.name}: ${fmtRupiah(balance)}`);
    } catch (e) {
      lines.push(`• ${acc.name}: gagal mengambil saldo (${(e as Error).message})`);
    }
  }
  lines.push("", `Total akun: ${accounts.length}`);
  return lines.join("\n");
}

/** Aktivitas tim dalam 24 jam terakhir: hitungan + contoh 5 terakhir. */
async function genActivityReport(teamId: string): Promise<string> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const logs = await prisma.activityLog.findMany({
    where: { teamId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const login = logs.filter((l) => l.action === "login");
  const power = logs.filter((l) => ["start", "stop", "restart"].includes(l.action));
  const syncFailed = logs.filter((l) => l.action === "sync" && l.status === "failed");

  const lines = ["📊 Laporan aktivitas — 24 jam terakhir", "", `Login: ${login.length}`, `Start/Stop/Restart: ${power.length}`, `Sync gagal: ${syncFailed.length}`, ""];
  if (logs.length === 0) {
    lines.push("Tidak ada aktivitas tercatat.");
  } else {
    lines.push("Contoh terakhir:");
    for (const l of logs.slice(0, 5)) {
      const extra = l.message ? ` (${l.message})` : "";
      lines.push(`• ${fmtStamp(l.createdAt)} — ${l.action}${extra}`);
    }
  }
  return lines.join("\n");
}

/** Ringkasan backup DB dalam 24 jam: sukses/gagal + daftar terakhir. */
async function genBackupReport(teamId: string): Promise<string> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const runs = await prisma.dbBackupRun.findMany({
    where: { startedAt: { gte: since }, job: { connection: { teamId } } },
    orderBy: { startedAt: "desc" },
    take: 200,
    include: { job: { select: { name: true } } },
  });

  const ok = runs.filter((r) => r.status === "success").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const running = runs.filter((r) => r.status === "running").length;

  const lines = ["💾 Laporan backup — 24 jam terakhir", "", `Sukses: ${ok}`, `Gagal: ${failed}`, running > 0 ? `Sedang berjalan: ${running}` : "", ""];
  if (runs.length === 0) {
    lines.push("Tidak ada run backup tercatat.");
  } else {
    lines.push("Run terakhir:");
    for (const r of runs.slice(0, 5)) {
      const status = r.status === "success" ? "sukses" : r.status === "running" ? "berjalan" : "gagal";
      lines.push(`• ${r.job.name} — ${status} — ${fmtStamp(r.startedAt)}`);
    }
  }
  return lines.join("\n");
}

/** Buat teks ringkasan laporan untuk satu tim sesuai jenisnya. */
export async function generateReport(teamId: string, type: string): Promise<string> {
  if (type === "cost") return genCostReport(teamId);
  if (type === "activity") return genActivityReport(teamId);
  if (type === "backup") return genBackupReport(teamId);
  return `Jenis laporan tidak dikenal: ${type}`;
}

async function runScheduledReport(job: { id: string; teamId: string | null; name: string; type: string }): Promise<void> {
  const text = await generateReport(job.teamId ?? "", job.type);
  await notifyTeam(job.teamId, "report", `📅 ${job.name}\n${text}`);
  await prisma.scheduledReport.update({ where: { id: job.id }, data: { lastRunAt: new Date() } });
}

/** Jalankan semua laporan terjadwal yang jatuh tempo menit ini (fire-and-forget aman). */
export async function runDueScheduledReports(now: Date = new Date()): Promise<string[]> {
  const jobs = await prisma.scheduledReport.findMany({ where: { enabled: true } });
  const started: string[] = [];
  for (const j of jobs) {
    if (j.lastRunAt && now.getTime() - j.lastRunAt.getTime() < DEDUP_MS) continue;
    if (!jobIsDue(j, now)) continue;
    started.push(j.name);
    void runScheduledReport(j).catch((e) => {
      console.error(`[REPORT] Laporan "${j.name}" gagal dijalankan: ${(e as Error).message}`);
    });
  }
  return started;
}
