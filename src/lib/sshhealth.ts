// SSH-based app health check: run a check command on a server via SSH.
// Healthy = command exits 0. Worker-safe: no "server-only", no Next.js imports.
import { Client as SshClient } from "ssh2";
import { prisma } from "./db";
import { sshCfgFrom } from "./sshmon";
import { notifyTeam } from "./notify";

const CONNECT_TIMEOUT_MS = 10_000;

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

function execWithTimeout(client: SshClient, command: string, timeoutSec: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`waktu habis (${timeoutSec}s)`));
    }, timeoutSec * 1000);
    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }
      let out = "";
      let errOut = "";
      stream.on("data", (d: Buffer) => {
        out += d.toString();
      });
      stream.stderr.on("data", (d: Buffer) => {
        errOut += d.toString();
      });
      stream.on("close", (code: number) => {
        clearTimeout(timer);
        resolve({ code, output: (out + errOut).trim().slice(0, 2000) });
      });
      stream.on("error", (e: Error) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  });
}

/** Cek satu health check SSH: jalankan perintah, exit 0 = sehat. */
export async function checkSshHealth(
  id: string,
  trigger: "manual" | "scheduler" = "scheduler",
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const hc = await prisma.sshHealthCheck.findUnique({ where: { id }, include: { ssh: true } });
  if (!hc) return { ok: false, error: "Health check tidak ditemukan" };

  const client = await openClient(sshCfgFrom(hc.ssh)).catch((e) => {
    throw new Error(`SSH gagal terhubung ke ${hc.ssh.host}: ${(e as Error).message}`);
  });

  try {
    const { code, output } = await execWithTimeout(client, hc.command, hc.timeoutSec || 30);
    const ok = code === 0;
    const prev = hc.lastStatus;

    await prisma.sshHealthCheck.update({
      where: { id },
      data: {
        lastStatus: ok ? "healthy" : "down",
        lastOutput: output || null,
        lastRunAt: new Date(),
      },
    });

    if (ok && prev !== "healthy") {
      await notifyTeam(hc.teamId, "error", `🟢 App health "${hc.name}" (${hc.ssh.name}) kembali normal.`);
    } else if (!ok && prev !== "down") {
      await notifyTeam(hc.teamId, "error", `🔴 App health "${hc.name}" (${hc.ssh.name}) TIDAK SEHAT${output ? `: ${output.slice(0, 200)}` : ""}`);
    }

    return { ok, output };
  } catch (e) {
    const msg = (e as Error).message;
    if (hc.lastStatus !== "down") {
      await notifyTeam(hc.teamId, "error", `🔴 App health "${hc.name}" (${hc.ssh.name}) TIDAK SEHAT: ${msg}`);
    }
    await prisma.sshHealthCheck.update({
      where: { id },
      data: { lastStatus: "down", lastOutput: msg.slice(0, 2000), lastRunAt: new Date() },
    });
    return { ok: false, error: msg };
  } finally {
    closeSsh(client);
  }
}

/** Jalankan semua health check SSH yang jatuh tempo. */
export async function checkDueSshHealth(now: Date = new Date()): Promise<number> {
  const checks = await prisma.sshHealthCheck.findMany({ where: { enabled: true } });
  let started = 0;
  for (const c of checks) {
    const due = !c.lastRunAt || now.getTime() - c.lastRunAt.getTime() >= (c.intervalMin || 1) * 60_000;
    if (due) {
      started++;
      void checkSshHealth(c.id).catch((e) => {
        console.error(`[SSHHEALTH] Cek "${c.name}" gagal: ${(e as Error).message}`);
      });
    }
  }
  return started;
}
