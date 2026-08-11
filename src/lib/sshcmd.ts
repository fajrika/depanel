// SSH command engine: run a command/script on a remote SSH server via a stored
// connection — manually (API) or on a schedule (worker). Worker-safe: no
// next/headers, no "server-only".
import { Client as SshClient } from "ssh2";
import { prisma } from "./db";
import { sshCfgFrom, type SshAuthCfg } from "./sshmon";
import { jobIsDue } from "./dbbackup";
import { notifyTeam } from "./notify";

/** Guard anti-duplikat per-proses: satu job tidak boleh berjalan bersamaan. */
const runningJobs = new Set<string>();

const CONNECT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 20 * 1024; // stdout+stderr dibatasi ~20KB

function openClient(cfg: SshAuthCfg): Promise<SshClient> {
  const client = new SshClient();
  return new Promise((resolve, reject) => {
    client.once("ready", () => resolve(client));
    client.once("error", (e) => reject(e));
    client.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      ...(cfg.authType === "key"
        ? { privateKey: cfg.privateKey, ...(cfg.keyPassphrase ? { passphrase: cfg.keyPassphrase } : {}) }
        : { password: cfg.password }),
      readyTimeout: CONNECT_TIMEOUT_MS,
    });
  });
}

function closeSsh(client: SshClient) {
  try {
    client.end();
  } catch {
    /* sudah ditutup */
  }
}

/** Jalankan perintah, kumpulkan stdout+stderr (maks 20KB), kembalikan exit code. */
function execCollect(client: SshClient, command: string, timeoutMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Perintah melebihi batas waktu eksekusi"));
    }, timeoutMs);
    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }
      let output = "";
      const push = (chunk: Buffer) => {
        if (output.length < MAX_OUTPUT) {
          output += chunk.toString("utf8").slice(0, MAX_OUTPUT - output.length);
        }
      };
      stream.on("data", push);
      stream.stderr.on("data", push);
      stream.on("close", (code: number | null) => {
        clearTimeout(timer);
        resolve({ code, output });
      });
      stream.on("error", (e: Error) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  });
}

/**
 * Jalankan satu job SSH command. Tidak pernah melempar unhandled rejection —
 * semua kegagalan dicatat ke SshCommandRun + log, proses tetap lanjut.
 */
export async function runSshCommandJob(jobId: string, trigger: "manual" | "scheduler" = "manual"): Promise<void> {
  if (runningJobs.has(jobId)) return; // sudah berjalan
  runningJobs.add(jobId);
  try {
    const job = await prisma.sshCommandJob.findUnique({ where: { id: jobId }, include: { ssh: true } });
    if (!job || !job.teamId || !job.ssh) {
      console.error(`[SSHCMD] Job ${jobId} tidak ditemukan`);
      return;
    }

    let runId: string;
    try {
      const run = await prisma.sshCommandRun.create({ data: { jobId, status: "running" } });
      runId = run.id;
      await prisma.sshCommandJob.update({ where: { id: jobId }, data: { lastStatus: "running", lastRunAt: new Date() } });
    } catch (e) {
      console.error(`[SSHCMD] Job "${job.name}" gagal memulai run: ${(e as Error).message}`);
      return;
    }

    const timeoutMs = Math.max(1, job.timeoutSec || 60) * 1000;
    let client: SshClient | null = null;
    try {
      client = await openClient(sshCfgFrom(job.ssh));
      const { code, output } = await execCollect(client, job.command, timeoutMs);
      const failed = code !== 0;
      await prisma.sshCommandRun.update({
        where: { id: runId },
        data: {
          status: failed ? "failed" : "success",
          exitCode: code,
          output,
          error: failed ? `exit code ${code}` : null,
          endedAt: new Date(),
        },
      });
      await prisma.sshCommandJob.update({ where: { id: jobId }, data: { lastStatus: failed ? "failed" : "success", lastRunAt: new Date() } });
      if (failed && trigger === "scheduler") {
        await notifyTeam(job.teamId, "error", `❌ SSH Command "${job.name}" GAGAL (exit ${code}).`);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error(`[SSHCMD] Job "${job.name}" failed: ${err.message}`);
      await prisma.sshCommandRun.update({
        where: { id: runId },
        data: { status: "failed", error: err.message.slice(0, 500), endedAt: new Date() },
      }).catch(() => {});
      await prisma.sshCommandJob.update({ where: { id: jobId }, data: { lastStatus: "failed", lastRunAt: new Date() } }).catch(() => {});
      if (trigger === "scheduler") {
        await notifyTeam(job.teamId, "error", `❌ SSH Command "${job.name}" GAGAL: ${err.message}`);
      }
    } finally {
      if (client) closeSsh(client);
    }
  } catch (e) {
    console.error(`[SSHCMD] Job ${jobId} error: ${(e as Error).message}`);
  } finally {
    runningJobs.delete(jobId);
  }
}

/** Jalankan semua job terjadwal yang jatuh tempo pada menit ini. */
export async function runDueSshCommandJobs(now: Date = new Date()): Promise<string[]> {
  const jobs = await prisma.sshCommandJob.findMany({
    where: { enabled: true },
    select: { id: true, name: true, scheduleType: true, timeAt: true, dayOn: true, cronExpr: true, timezone: true },
  });
  const started: string[] = [];
  for (const j of jobs) {
    if (j.scheduleType === "manual") continue;
    if (!jobIsDue(j, now)) continue;
    started.push(j.name);
    // fire-and-forget, tapi rejection tidak boleh mematikan worker
    void runSshCommandJob(j.id, "scheduler").catch((e) => {
      console.error(`[SSHCMD] Job "${j.name}" gagal dijalankan: ${(e as Error).message}`);
    });
  }
  return started;
}
