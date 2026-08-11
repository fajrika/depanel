// Directory clone engine: tar.gz a directory from an SSH server and ship it to
// a destination (local path on the panel host / Google Drive / another SSH server).
// Worker-safe: no "server-only", no Next.js imports.
import fsp from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client as SshClient } from "ssh2";
import type { Duplex } from "node:stream";
import { pipeline } from "node:stream/promises";
import { prisma } from "./db";
import { sshCfgFrom } from "./sshmon";
import { getGDriveOAuthToken, gdriveOAuthUpload } from "./gdrive-oauth";
import { notifyTeam } from "./notify";
import { jobIsDue } from "./dbbackup";

const CONNECT_TIMEOUT_MS = 10_000;
const TAR_TIMEOUT_MS = 60 * 60 * 1000;

function openClient(cfg: ReturnType<typeof sshCfgFrom>): Promise<SshClient> {
  const client = new SshClient();
  return new Promise((resolve, reject) => {
    client.once("ready", () => resolve(client));
    client.once("error", (e) => reject(e));
    client.connect({ ...cfg, readyTimeout: CONNECT_TIMEOUT_MS });
  });
}

function closeSsh(client: SshClient) {
  try {
    client.end();
  } catch {
    /* already closed */
  }
}

/** Shell single-quote escape. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Execute a command and stream its stdout. Resolves { stream, code } on close. */
function execStream(
  client: SshClient,
  command: string,
): Promise<{ stream: Duplex; code: Promise<number | null> }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let errOut = "";
      stream.stderr.on("data", (d: Buffer) => {
        errOut += d.toString();
      });
      const code = new Promise<number | null>((res) => {
        stream.on("close", (c: number) => {
          if (c !== 0) stream.emit("error", new Error(`exit ${c}: ${errOut.trim().slice(0, 300)}`));
          res(c);
        });
      });
      resolve({ stream, code });
    });
  });
}

/** Run `tar czf - -C <dir> <base>` on the source server. dir/base must be absolute-safe. */
function buildTarCommand(sourcePath: string): string {
  // hilangkan trailing slash agar basename tidak kosong (mis. "/var/www/")
  const trimmed = sourcePath.replace(/\/+$/, "");
  const dir = path.posix.dirname(trimmed === "" ? "/" : trimmed);
  const base = trimmed === "" ? "." : path.posix.basename(trimmed);
  return `tar czf - -C ${shq(dir)} ${shq(base)}`;
}

const runningJobs = new Set<string>();

/** Dianggap macet jika run "running" berusia lebih dari batas ini. */
const STALE_RUN_MS = 6 * 60 * 60 * 1000;

export async function runCloneJob(jobId: string, trigger: "manual" | "scheduler" = "manual"): Promise<void> {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);

  const job = await prisma.dirCloneJob.findUnique({
    where: { id: jobId },
    include: { sourceSsh: true, destSsh: true },
  });
  if (!job) {
    runningJobs.delete(jobId);
    return;
  }

  // reset sisa run "running" dari proses yang mati/crash
  await prisma.dirCloneRun.updateMany({
    where: { jobId, status: "running", startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
    data: { status: "failed", message: "Proses terhenti (crash) — di-reset otomatis", endedAt: new Date() },
  });

  let runId: string;
  try {
    const run = await prisma.dirCloneRun.create({ data: { jobId, status: "running", message: `trigger: ${trigger}` } });
    runId = run.id;
    await prisma.dirCloneJob.update({ where: { id: jobId }, data: { lastStatus: "running" } });
  } catch (e) {
    console.error(`[DIRCLONE] Job "${job.name}" gagal memulai run: ${(e as Error).message}`);
    runningJobs.delete(jobId);
    return;
  }

  const src = await openClient(sshCfgFrom(job.sourceSsh)).catch((e) => {
    return Promise.reject(new Error(`SSH sumber gagal terhubung ke ${job.sourceSsh.host}: ${(e as Error).message}`));
  });
  let dst: SshClient | null = null;

  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `${job.name.replace(/[^a-zA-Z0-9_-]+/g, "_")}-${stamp}.tar.gz`;

    const { stream: tarStream, code } = await execStream(src, buildTarCommand(job.sourcePath));

    let sizeBytes = 0;
    tarStream.on("data", (d: Buffer) => {
      sizeBytes += d.length;
    });

    const timeout = setTimeout(() => {
      tarStream.emit("error", new Error(`clone melebihi batas waktu (${TAR_TIMEOUT_MS / 1000 / 60} menit)`));
    }, TAR_TIMEOUT_MS);

    let location: string;
    try {
      if (job.destType === "local") {
        const dir = job.destPath || "";
        if (!dir) throw new Error("Path tujuan lokal belum diisi");
        await fsp.mkdir(dir, { recursive: true });
        const target = path.join(dir, fileName);
        const out = fs.createWriteStream(target);
        await pipeline(tarStream, out);
        location = target;
      } else if (job.destType === "gdrive") {
        if (!job.destGdriveId) throw new Error("Koneksi tujuan Google Drive belum dipilih");
        const chunks: Buffer[] = [];
        await pipeline(tarStream, async function* (source) {
          for await (const c of source) chunks.push(c as Buffer);
          yield; // satisfy pipeline sink
        });
        const token = await getGDriveOAuthToken(job.destGdriveId);
        const folderId = job.destPath || "";
        if (!folderId) throw new Error("Folder ID Google Drive belum diisi");
        const fileId = await gdriveOAuthUpload(token, folderId, fileName, Buffer.concat(chunks));
        location = `gdrive://${fileId}`;
      } else if (job.destType === "ssh") {
        if (!job.destSsh) throw new Error("Koneksi SSH tujuan belum dipilih");
        const destPath = job.destPath || "";
        if (!destPath) throw new Error("Path tujuan SSH belum diisi");
        dst = await openClient(sshCfgFrom(job.destSsh));
        const { stream: dstStream, code: dstCode } = await execStream(
          dst,
          `mkdir -p ${shq(path.posix.dirname(destPath))} && cat > ${shq(destPath)}`,
        );
        tarStream.pipe(dstStream);
        const [c1, c2] = await Promise.all([code, dstCode]);
        if (c1 !== 0 || c2 !== 0) {
          throw new Error(`clone gagal (source exit ${c1}, dest exit ${c2})`);
        }
        location = `ssh://${job.destSsh.host}:${destPath}`;
      } else {
        throw new Error(`Tujuan tidak dikenal: ${job.destType}`);
      }

      clearTimeout(timeout);
      const runCode = await code;
      if (runCode !== 0) throw new Error(`tar di server sumber gagal (exit ${runCode})`);
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }

    await prisma.dirCloneRun.update({
      where: { id: runId },
      data: { status: "success", sizeBytes, location, endedAt: new Date(), message: `${job.destType}` },
    });
    await prisma.dirCloneJob.update({ where: { id: jobId }, data: { lastStatus: "success", lastRunAt: new Date() } });

    await cleanupRetention(jobId);

    if (trigger === "scheduler") {
      await notifyTeam(job.teamId, "backup", `📦 Clone direktori "${job.name}" sukses (${(sizeBytes / 1024 / 1024).toFixed(1)} MB).`);
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[DIRCLONE] Job "${job.name}" failed: ${msg}`);
    await prisma.dirCloneRun.update({
      where: { id: runId },
      data: { status: "failed", message: msg, endedAt: new Date() },
    });
    await prisma.dirCloneJob.update({ where: { id: jobId }, data: { lastStatus: "failed", lastRunAt: new Date() } });
    await notifyTeam(job.teamId, "backup", `❌ Clone direktori "${job.name}" GAGAL: ${msg}`);
  } finally {
    closeSsh(src);
    if (dst) closeSsh(dst);
    runningJobs.delete(jobId);
  }
}

/** Hapus run lama sesuai retention (0 = simpan semua). Untuk tujuan lokal file ikut dihapus. */
export async function cleanupRetention(jobId: string): Promise<void> {
  const job = await prisma.dirCloneJob.findUnique({ where: { id: jobId } });
  if (!job || job.retention <= 0) return;

  const runs = await prisma.dirCloneRun.findMany({
    where: { jobId, status: "success" },
    orderBy: { startedAt: "desc" },
  });
  if (runs.length <= job.retention) return;

  for (const run of runs.slice(job.retention)) {
    if (job.destType === "local" && run.location) {
      await fsp.rm(run.location, { force: true }).catch(() => {});
    }
    await prisma.dirCloneRun.delete({ where: { id: run.id } }).catch(() => {});
  }
}

/** Jalankan semua job clone yang jatuh tempo menit ini. */
export async function runDueCloneJobs(now: Date = new Date()): Promise<string[]> {
  const jobs = await prisma.dirCloneJob.findMany({ where: { enabled: true } });
  const started: string[] = [];
  for (const j of jobs) {
    if (j.scheduleType === "manual") continue;
    if (jobIsDue(j, now)) {
      started.push(j.name);
      void runCloneJob(j.id, "scheduler").catch((e) => {
        console.error(`[DIRCLONE] Job "${j.name}" gagal dijalankan: ${(e as Error).message}`);
      });
    }
  }
  return started;
}
