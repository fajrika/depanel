// SSH server monitoring: periodic (worker) + on-demand (API) sampling.
// Worker-safe: no "server-only", no Next.js imports.
import { Client as SshClient } from "ssh2";
import { prisma } from "./db";
import { decryptSecret } from "./crypto";

export type SshAuthCfg = {
  host: string;
  port: number;
  username: string;
  authType: "password" | "key";
  password: string;
  privateKey?: string;
  keyPassphrase?: string;
};

type SshRow = {
  host: string;
  port: number;
  username: string;
  authType: string;
  passwordEnc: string;
  privateKeyEnc: string | null;
  keyPassphraseEnc: string | null;
};

export type DiskMount = { mount: string; sizeMb: number; usedMb: number; pct: number };
export type ProcInfo = { pid: string; user: string; cpu: number; mem: number; comm: string };

export type LiveSample = {
  hostname?: string;
  osName?: string;
  kernel?: string;
  cpu?: number;
  cpuCores?: number;
  memPct?: number;
  memUsedMb?: number;
  memTotalMb?: number;
  load1?: number;
  load5?: number;
  load15?: number;
  uptimeSec?: number;
  netInBps?: number;
  netOutBps?: number;
  disk: DiskMount[];
  topProcs: ProcInfo[];
  ports: string[];
  failedSvcs: string[];
};

/** Build a connect config from a stored SshConnection row, decrypting secrets. */
export function sshCfgFrom(r: SshRow): SshAuthCfg {
  return {
    host: r.host,
    port: r.port,
    username: r.username,
    authType: r.authType === "key" ? "key" : "password",
    password: decryptSecret(r.passwordEnc),
    privateKey: r.privateKeyEnc ? decryptSecret(r.privateKeyEnc) : undefined,
    keyPassphrase: r.keyPassphraseEnc ? decryptSecret(r.keyPassphraseEnc) : undefined,
  };
}

const CONNECT_TIMEOUT_MS = 10_000;
const EXEC_TIMEOUT_MS = 8_000;
const SAMPLE_GAP_MS = 1_000;
const TOTAL_DEADLINE_MS = 20_000;

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
    /* already closed */
  }
}

function exec(client: SshClient, command: string, timeoutMs = EXEC_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`waktu habis mengeksekusi: ${command.slice(0, 48)}`));
    }, timeoutMs);
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
        // nonzero exit is tolerated if we still got output (some utils print to stdout + exit 1)
        if (code !== 0 && !out.trim()) {
          reject(new Error(`${command.slice(0, 48)} (exit ${code}): ${errOut.trim().slice(0, 200)}`));
        } else {
          resolve(out);
        }
      });
      stream.on("error", (e: Error) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  });
}

function num(s: string | undefined): number | undefined {
  const n = s === undefined ? NaN : Number.parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

function parseLoadavg(out: string): { load1?: number; load5?: number; load15?: number } {
  const p = out.trim().split(/\s+/);
  return { load1: num(p[0]), load5: num(p[1]), load15: num(p[2]) };
}

function parseUptime(out: string): number | undefined {
  const sec = num(out.trim().split(/\s+/)[0]);
  return sec === undefined ? undefined : Math.round(sec);
}

function parseMeminfo(out: string): { memTotalMb?: number; memUsedMb?: number; memPct?: number } {
  const kv: Record<string, number> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) kv[m[1]] = Number.parseInt(m[2], 10);
  }
  const totalKb = kv["MemTotal"];
  if (!totalKb) return {};
  const availKb = kv["MemAvailable"] ?? (kv["MemFree"] ?? 0) + (kv["Buffers"] ?? 0) + (kv["Cached"] ?? 0);
  const usedKb = Math.max(0, totalKb - availKb);
  const memTotalMb = Math.round(totalKb / 1024);
  const memUsedMb = Math.round(usedKb / 1024);
  return { memTotalMb, memUsedMb, memPct: Math.round((usedKb / totalKb) * 1000) / 10 };
}

function cpuPctFromStat(a: string, b: string): number | undefined {
  const fields = (s: string) => s.split(/\s+/).slice(1).map((v) => Number.parseInt(v, 10) || 0);
  const fa = fields(a);
  const fb = fields(b);
  if (fa.length < 4 || fb.length < 4) return undefined;
  const idle = (f: number[]) => (f[3] ?? 0) + (f[4] ?? 0); // idle + iowait
  const total = (f: number[]) => f.reduce((s, v) => s + v, 0);
  const dTotal = total(fb) - total(fa);
  const dIdle = idle(fb) - idle(fa);
  if (dTotal <= 0) return undefined;
  return Math.max(0, Math.round((1 - dIdle / dTotal) * 1000) / 10);
}

function netRatesFromDev(a: string, b: string, seconds: number): { inBps?: number; outBps?: number } {
  const parse = (out: string) => {
    const map = new Map<string, { rx: number; tx: number }>();
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*([^:\s]+):\s+([\d\s]+)$/);
      if (!m) continue;
      if (m[1] === "lo") continue;
      const nums = m[2].trim().split(/\s+/).map((v) => Number.parseInt(v, 10) || 0);
      if (nums.length < 9) continue;
      map.set(m[1], { rx: nums[0], tx: nums[8] });
    }
    return map;
  };
  const fa = parse(a);
  const fb = parse(b);
  let rx = 0;
  let tx = 0;
  for (const [iface, bval] of fb) {
    const aval = fa.get(iface);
    if (!aval) continue;
    rx += Math.max(0, bval.rx - aval.rx);
    tx += Math.max(0, bval.tx - aval.tx);
  }
  return { inBps: Math.round(rx / seconds), outBps: Math.round(tx / seconds) };
}

const SKIP_MOUNT_PREFIX = ["/proc", "/sys", "/dev", "/run", "/snap"];
const SKIP_FS = new Set(["tmpfs", "devtmpfs", "udev", "overlay", "squashfs", "iso9660", "shm"]);

function parseDf(out: string): DiskMount[] {
  const mounts: DiskMount[] = [];
  for (const line of out.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [fs, blocks, used, , cap, ...mountRest] = parts;
    const mount = mountRest.join(" ");
    if (!mount.startsWith("/")) continue;
    if (SKIP_FS.has(fs)) continue;
    if (SKIP_MOUNT_PREFIX.some((p) => mount.startsWith(p))) continue;
    const sizeMb = Math.round((Number(blocks) || 0) / 1024);
    const usedMb = Math.round((Number(used) || 0) / 1024);
    const pct = Number(cap?.replace("%", "")) || (sizeMb ? Math.round((usedMb / sizeMb) * 1000) / 10 : 0);
    mounts.push({ mount, sizeMb, usedMb, pct });
  }
  return mounts;
}

function parsePs(out: string): ProcInfo[] {
  const procs: ProcInfo[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
    if (!m) continue;
    procs.push({
      pid: m[1],
      user: m[2],
      cpu: Math.round(Number.parseFloat(m[3]) * 10) / 10,
      mem: Math.round(Number.parseFloat(m[4]) * 10) / 10,
      comm: m[5].trim().slice(0, 60),
    });
  }
  return procs;
}

function parseListenPorts(out: string): string[] {
  const ports = new Set<string>();
  for (const line of out.split("\n")) {
    const parts = line.trim().split(/\s+/);
    const local = parts[3]; // same column for both `ss -tlnH` and `netstat -tln`
    if (!local || !local.includes(":")) continue;
    const port = local.split(":").pop();
    if (port && /^\d+$/.test(port)) ports.add(port);
  }
  return [...ports];
}

function parseFailedSvcs(out: string): string[] {
  return out
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((n) => n && n.endsWith(".service"));
}

/** Connect and collect a live metric snapshot. Throws on failure. */
export async function collectSshMetrics(cfg: SshAuthCfg): Promise<LiveSample> {
  const client = await openClient(cfg);
  const deadline = setTimeout(() => {
    closeSsh(client);
  }, TOTAL_DEADLINE_MS);
  try {
    const [osOut, kernelOut, hostnameOut, loadOut, upOut, memOut, coresOut] = await Promise.all([
      exec(client, "cat /etc/os-release"),
      exec(client, "uname -sr"),
      exec(client, "cat /etc/hostname"),
      exec(client, "cat /proc/loadavg"),
      exec(client, "cat /proc/uptime"),
      exec(client, "cat /proc/meminfo"),
      exec(client, "nproc"),
    ]);

    const stat1 = await exec(client, "cat /proc/stat");
    const net1 = await exec(client, "cat /proc/net/dev");
    await new Promise((r) => setTimeout(r, SAMPLE_GAP_MS));
    const stat2 = await exec(client, "cat /proc/stat");
    const net2 = await exec(client, "cat /proc/net/dev");

    const osName = /^PRETTY_NAME="?(.*?)"?$/m.exec(osOut)?.[1]?.trim() ?? undefined;
    const cpu = cpuPctFromStat(stat1, stat2);
    const net = netRatesFromDev(net1, net2, SAMPLE_GAP_MS / 1000);
    const load = parseLoadavg(loadOut);
    const mem = parseMeminfo(memOut);

    const disk = parseDf(await exec(client, "df -kP"));
    const topProcs = await exec(client, "ps -eo pid:12,user:20,pcpu:6,pmem:6,comm --sort=-pcpu --no-headers | head -n 11").then(parsePs).catch(() => []);
    const ports = await exec(client, "ss -tlnH").catch(() => exec(client, "netstat -tln")).then(parseListenPorts).catch(() => []);
    const failedSvcs = await exec(client, "systemctl list-units --type=service --state=failed --no-legend --no-pager", 6_000)
      .then(parseFailedSvcs)
      .catch(() => []);

    return {
      hostname: hostnameOut.trim() || undefined,
      osName,
      kernel: kernelOut.trim() || undefined,
      cpu,
      cpuCores: num(coresOut),
      ...mem,
      ...load,
      uptimeSec: parseUptime(upOut),
      netInBps: net.inBps,
      netOutBps: net.outBps,
      disk,
      topProcs,
      ports,
      failedSvcs,
    };
  } finally {
    clearTimeout(deadline);
    closeSsh(client);
  }
}

/** Sample one stored connection: connect, collect, persist (ok=true), return the live data. */
export async function sampleSshConnection(sshId: string): Promise<{ ok: boolean; error?: string; sample?: LiveSample }> {
  const row = await prisma.sshConnection.findUnique({
    where: { id: sshId },
    select: { id: true, host: true, port: true, username: true, authType: true, passwordEnc: true, privateKeyEnc: true, keyPassphraseEnc: true },
  });
  if (!row) return { ok: false, error: "Koneksi SSH tidak ditemukan" };

  try {
    const sample = await collectSshMetrics(sshCfgFrom(row));
    await prisma.sshMetricSample.create({
      data: {
        sshId: row.id,
        ok: true,
        hostname: sample.hostname,
        osName: sample.osName,
        kernel: sample.kernel,
        cpu: sample.cpu,
        cpuCores: sample.cpuCores,
        memPct: sample.memPct,
        memUsedMb: sample.memUsedMb,
        memTotalMb: sample.memTotalMb,
        load1: sample.load1,
        load5: sample.load5,
        load15: sample.load15,
        uptimeSec: sample.uptimeSec,
        netInBps: sample.netInBps,
        netOutBps: sample.netOutBps,
        disk: JSON.stringify(sample.disk),
        topProcs: JSON.stringify(sample.topProcs),
        ports: JSON.stringify(sample.ports),
        failedSvcs: JSON.stringify(sample.failedSvcs),
      },
    });
    return { ok: true, sample };
  } catch (e) {
    const message = (e as Error).message || String(e);
    await prisma.sshMetricSample.create({
      data: { sshId: row.id, ok: false, error: message.slice(0, 500) },
    });
    return { ok: false, error: message };
  }
}

/** Sample every team-scoped connection. Returns the number of connections processed. */
export async function sampleAllSshMetrics(): Promise<number> {
  const rows = await prisma.sshConnection.findMany({
    where: { teamId: { not: null } },
    select: { id: true },
  });
  for (const r of rows) {
    try {
      await sampleSshConnection(r.id);
    } catch {
      /* keep sampling the rest */
    }
  }
  // retention: keep ~30 days of samples
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await prisma.sshMetricSample.deleteMany({ where: { at: { lt: cutoff } } });
  return rows.length;
}

/** Uptime % and sample series for an SSH connection over the last `hours`. */
export async function getSshHistory(sshId: string, hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const samples = await prisma.sshMetricSample.findMany({
    where: { sshId, at: { gte: since } },
    orderBy: { at: "asc" },
    select: { at: true, ok: true, cpu: true, memPct: true, netInBps: true, netOutBps: true },
  });
  const total = samples.length;
  const up = samples.filter((s) => s.ok).length;
  return {
    uptimePct: total ? Math.round((up / total) * 1000) / 10 : null,
    samples: samples.map((s) => ({
      t: s.at.toISOString(),
      ok: s.ok,
      cpu: s.cpu,
      memPct: s.memPct,
      netInBps: s.netInBps,
      netOutBps: s.netOutBps,
    })),
  };
}
