// Panel database (SQLite) backup: snapshot konsisten via VACUUM INTO, lalu
// kirim ke destinasi (local/FTP/S3/GDrive) dengan deliver() dari dbbackup.
// Worker-safe: no "server-only", no Next.js imports.
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { prisma } from "./db";
import { deliver, destCfgFrom, fetchBackup } from "./dbbackup";
import { notifyTeam } from "./notify";
import { jobIsDue } from "./dbbackup";

const STALE_RUN_MS = 2 * 60 * 60 * 1000;

/** Snapshot SQLite yang konsisten (aman walau ada penulis) ke file sementara. */
export async function snapshotDatabase(): Promise<{ filePath: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = path.join(os.tmpdir(), `depanel-panel-${stamp}.db`);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${outPath.replace(/'/g, "''")}'`);
  return { filePath: outPath };
}

const runningBackups = new Set<string>();

export async function runPanelBackup(backupId: string, trigger: "manual" | "scheduler" = "manual"): Promise<{ ok: boolean; message?: string }> {
  if (runningBackups.has(backupId)) return { ok: false, message: "Backup sedang berjalan" };
  runningBackups.add(backupId);

  const b = await prisma.panelBackup.findUnique({ where: { id: backupId } });
  if (!b) {
    runningBackups.delete(backupId);
    return { ok: false, message: "Pengaturan tidak ditemukan" };
  }

  // reset run macet
  await prisma.panelBackupRun.updateMany({
    where: { panelBackupId: backupId, status: "running", startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
    data: { status: "failed", message: "Proses terhenti (crash) — di-reset otomatis", endedAt: new Date() },
  });

  let runId: string;
  try {
    const run = await prisma.panelBackupRun.create({ data: { panelBackupId: backupId, status: "running", message: `trigger: ${trigger}` } });
    runId = run.id;
  } catch (e) {
    console.error(`[PANELBACKUP] Gagal memulai run: ${(e as Error).message}`);
    runningBackups.delete(backupId);
    return { ok: false, message: "Gagal memulai run" };
  }

  let tmp: string | null = null;
  try {
    const snap = await snapshotDatabase();
    tmp = snap.filePath;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `depanel-${stamp}.db`;
    const size = (await fsp.stat(tmp)).size;

    const cfg = await destCfgFrom(b);
    const location = await deliver(b.destType, cfg, tmp, fileName, b.destId ?? undefined);

    await prisma.panelBackupRun.update({
      where: { id: runId },
      data: { status: "success", sizeBytes: size, location, endedAt: new Date(), message: "Snapshot SQLite dikirim" },
    });
    await prisma.panelBackup.update({ where: { id: backupId }, data: { lastStatus: "success", lastRunAt: new Date() } });

    if (trigger === "scheduler") {
      await notifyTeam(b.teamId, "backup", `🗄️ Backup panel sukses (${(size / 1024 / 1024).toFixed(1)} MB).`);
    }
    return { ok: true, message: location };
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[PANELBACKUP] Gagal: ${msg}`);
    await prisma.panelBackupRun.update({ where: { id: runId }, data: { status: "failed", message: msg, endedAt: new Date() } });
    await prisma.panelBackup.update({ where: { id: backupId }, data: { lastStatus: "failed", lastRunAt: new Date() } });
    return { ok: false, message: msg };
  } finally {
    if (tmp) await fsp.rm(tmp, { force: true }).catch(() => {});
    runningBackups.delete(backupId);
  }
}

/** Jalankan backup panel yang jatuh tempo (tiap menit dari worker). */
export async function runDuePanelBackups(now: Date = new Date()): Promise<string[]> {
  const backups = await prisma.panelBackup.findMany({ where: { enabled: true } });
  const started: string[] = [];
  for (const b of backups) {
    if (b.scheduleType === "manual") continue;
    if (jobIsDue(b, now)) {
      started.push(b.name);
      void runPanelBackup(b.id, "scheduler").catch((e) => {
        console.error(`[PANELBACKUP] "${b.name}" gagal dijalankan: ${(e as Error).message}`);
      });
    }
  }
  return started;
}

/** Ambil file run (download): untuk destinasi remote via fetchBackup. */
export async function fetchRunFile(run: { location: string | null; panelBackup: { destType: string; destPath: string | null; destId: string | null } }, targetPath: string): Promise<string> {
  const cfg = await destCfgFrom(run.panelBackup);
  return fetchBackup(run.panelBackup.destType, cfg, run.location ?? "", targetPath, run.panelBackup.destId ?? undefined);
}
