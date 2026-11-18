// Speedtest engine: ukur kecepatan internet server SSH (download, upload, ping,
// jitter, packet loss) — manual (API) atau terjadwal (worker). Hasil disimpan di
// SpeedtestResult. Worker-safe: tanpa next/headers dan tanpa "server-only".
//
// Tool di server remote dipilih otomatis (bisa dipaksa per job):
//   1. Speedtest by Ookla (`speedtest`)      — paling akurat, ada jitter & packet loss
//   2. speedtest-cli (Python, `speedtest-cli`) — alternatif yang umum di repo distro
//   3. curl ke speed.cloudflare.com           — tanpa instalasi apa pun (perkiraan)
// Bila tidak satu pun tersedia, run gagal dengan petunjuk instalasi yang jelas.
import { Client as SshClient } from "ssh2";
import { prisma } from "./db";
import { sshCfgFrom, type SshAuthCfg } from "./sshmon";
import { jobIsDue } from "./dbbackup";
import { notifyTeam } from "./notify";

export const SPEEDTEST_TOOLS = ["auto", "ookla", "speedtest-cli", "curl"] as const;
export type SpeedtestTool = (typeof SPEEDTEST_TOOLS)[number];

export const TOOL_LABEL: Record<string, string> = {
  ookla: "Speedtest by Ookla",
  "speedtest-cli": "speedtest-cli (Python)",
  curl: "curl (Cloudflare)",
};

/** Petunjuk instalasi (ditampilkan di UI & pesan error). */
export const INSTALL_HINT = [
  "Pasang salah satu tool speedtest di server:",
  "- Ookla (Debian/Ubuntu): curl -s https://packagecloud.io/install/repositories/ookla/speedtest-cli/script.deb.sh | sudo bash && sudo apt-get install -y speedtest",
  "- Ookla (RHEL/CentOS/Alma/Rocky): curl -s https://packagecloud.io/install/repositories/ookla/speedtest-cli/script.rpm.sh | sudo bash && sudo yum install -y speedtest",
  "- speedtest-cli: sudo apt-get install -y speedtest-cli  (atau: pip3 install speedtest-cli)",
  "- Tanpa instalasi: pastikan `curl` tersedia lalu pilih tool \"curl (Cloudflare)\".",
].join("\n");

const CONNECT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT = 64 * 1024;
const TOOL_MARK = "__DEPANEL_TOOL__";
const MISSING_MARK = "__DEPANEL_MISSING__";

/** Guard anti-duplikat per proses: satu job & satu server tidak diuji bersamaan. */
const runningJobs = new Set<string>();
const busySsh = new Set<string>();

export function isSpeedtestBusy(jobId: string, sshId: string): boolean {
  return runningJobs.has(jobId) || busySsh.has(sshId);
}

/* ------------------------------------------------------------------ */
/* SSH                                                                  */
/* ------------------------------------------------------------------ */

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

/** Jalankan perintah; stdout & stderr dipisah, stdin langsung ditutup. */
function execSplit(client: SshClient, command: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let channel: { close: () => void } | undefined;
    const timer = setTimeout(() => {
      settled = true;
      try {
        channel?.close();
      } catch {
        /* abaikan */
      }
      reject(new Error(`Speedtest melebihi batas waktu ${Math.round(timeoutMs / 1000)} detik`));
    }, timeoutMs);
    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        if (!settled) reject(err);
        settled = true;
        return;
      }
      channel = stream;
      try {
        stream.end(); // stdin EOF: prompt apa pun di sisi remote tidak menggantung
      } catch {
        /* abaikan */
      }
      stream.on("data", (c: Buffer) => {
        if (stdout.length < MAX_OUTPUT) stdout += c.toString("utf8").slice(0, MAX_OUTPUT - stdout.length);
      });
      stream.stderr.on("data", (c: Buffer) => {
        if (stderr.length < MAX_OUTPUT) stderr += c.toString("utf8").slice(0, MAX_OUTPUT - stderr.length);
      });
      stream.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({ code, stdout, stderr });
      });
      stream.on("error", (e: Error) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(e);
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/* Script remote                                                        */
/* ------------------------------------------------------------------ */

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const SCRIPT_LIB = `
has() { command -v "$1" >/dev/null 2>&1; }
is_ookla() { has speedtest && speedtest --version 2>/dev/null </dev/null | grep -qi ookla; }
py_st() {
  if has speedtest-cli; then echo speedtest-cli; return 0; fi
  if has speedtest && ! is_ookla; then echo speedtest; return 0; fi
  if has python3 && python3 -c 'import speedtest' >/dev/null 2>&1 </dev/null; then echo "python3 -m speedtest"; return 0; fi
  return 1
}
`;

export function buildRunScript(tool: SpeedtestTool, serverId: string | null): string {
  const sid = (serverId ?? "").replace(/[^0-9]/g, "");
  return `${SCRIPT_LIB}
TOOL=${shQuote(tool)}
SID=${shQuote(sid)}
run_ookla() {
  echo "${TOOL_MARK} ookla"
  if [ -n "$SID" ]; then speedtest --accept-license --accept-gdpr -f json -s "$SID" </dev/null
  else speedtest --accept-license --accept-gdpr -f json </dev/null; fi
}
run_py() {
  c=$(py_st)
  echo "${TOOL_MARK} speedtest-cli"
  if [ -n "$SID" ]; then $c --json --secure --server "$SID" </dev/null
  else $c --json --secure </dev/null; fi
}
run_curl() {
  echo "${TOOL_MARK} curl"
  U=https://speed.cloudflare.com
  printf '__META__ '; curl -s -m 10 "$U/meta" </dev/null | tr -d '\\n'; echo
  i=0
  while [ $i -lt 8 ]; do
    curl -s -o /dev/null -m 10 -w '__PING__ %{time_pretransfer} %{time_starttransfer} %{http_code}\\n' "$U/__down?bytes=0" </dev/null
    i=$((i+1))
  done
  curl -s -o /dev/null -m 25 -w '__DOWN__ %{speed_download} %{size_download} %{http_code}\\n' "$U/__down?bytes=100000000" </dev/null
  head -c 25000000 /dev/zero | curl -s -o /dev/null -m 25 -w '__UP__ %{speed_upload} %{size_upload} %{http_code}\\n' -X POST -H 'Content-Type: application/octet-stream' --data-binary @- "$U/__up"
  return 0
}
case "$TOOL" in
  ookla) if is_ookla; then run_ookla; else echo "${MISSING_MARK} ookla"; fi ;;
  speedtest-cli) if py_st >/dev/null; then run_py; else echo "${MISSING_MARK} speedtest-cli"; fi ;;
  curl) if has curl; then run_curl; else echo "${MISSING_MARK} curl"; fi ;;
  *) if is_ookla; then run_ookla; elif py_st >/dev/null; then run_py; elif has curl; then run_curl; else echo "${MISSING_MARK} all"; fi ;;
esac
`;
}

const DETECT_SCRIPT = `${SCRIPT_LIB}
o=0; p=0; c=0
is_ookla && o=1
py_st >/dev/null && p=1
has curl && c=1
os=$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -s)
echo "__DETECT__ ookla=$o speedtest-cli=$p curl=$c"
echo "__OS__ $os"
`;

/** Bungkus script agar aman dari quoting & dijalankan oleh /bin/sh (bukan shell login user). */
export function wrapScript(script: string): string {
  const b64 = Buffer.from(script, "utf8").toString("base64");
  return `sh -c "$(printf %s '${b64}' | base64 -d)"`;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                              */
/* ------------------------------------------------------------------ */

export type SpeedtestMeasure = {
  tool: string;
  downloadMbps: number | null;
  uploadMbps: number | null;
  pingMs: number | null;
  jitterMs: number | null;
  packetLoss: number | null;
  bytesDown: number | null;
  bytesUp: number | null;
  serverName: string | null;
  serverLocation: string | null;
  serverHost: string | null;
  isp: string | null;
  externalIp: string | null;
  resultUrl: string | null;
};

const emptyMeasure = (tool: string): SpeedtestMeasure => ({
  tool,
  downloadMbps: null,
  uploadMbps: null,
  pingMs: null,
  jitterMs: null,
  packetLoss: null,
  bytesDown: null,
  bytesUp: null,
  serverName: null,
  serverLocation: null,
  serverHost: null,
  isp: null,
  externalIp: null,
  resultUrl: null,
});

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : null);
const round = (v: number | null, d = 2): number | null => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const intOrNull = (v: number | null): number | null => (v == null ? null : Math.min(2_000_000_000, Math.max(0, Math.round(v))));

function jsonObjects(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l.startsWith("{")) continue;
    try {
      const v = JSON.parse(l);
      if (v && typeof v === "object") out.push(v as Record<string, unknown>);
    } catch {
      /* bukan JSON */
    }
  }
  return out;
}

function parseOokla(body: string): SpeedtestMeasure | string {
  const objs = jsonObjects(body);
  const r = objs.find((o) => o.type === "result" || (o.download && o.upload));
  if (!r) {
    const logs = objs.filter((o) => o.type === "log").map((o) => str(o.message, 300)).filter(Boolean);
    return logs.join("; ") || "Output Ookla tidak berisi hasil";
  }
  const m = emptyMeasure("ookla");
  const ping = (r.ping ?? {}) as Record<string, unknown>;
  const dl = (r.download ?? {}) as Record<string, unknown>;
  const ul = (r.upload ?? {}) as Record<string, unknown>;
  const srv = (r.server ?? {}) as Record<string, unknown>;
  const iface = (r.interface ?? {}) as Record<string, unknown>;
  const res = (r.result ?? {}) as Record<string, unknown>;
  const bwDl = num(dl.bandwidth);
  const bwUl = num(ul.bandwidth);
  m.downloadMbps = round(bwDl == null ? null : (bwDl * 8) / 1e6);
  m.uploadMbps = round(bwUl == null ? null : (bwUl * 8) / 1e6);
  m.pingMs = round(num(ping.latency));
  m.jitterMs = round(num(ping.jitter));
  m.packetLoss = round(num(r.packetLoss));
  m.bytesDown = intOrNull(num(dl.bytes));
  m.bytesUp = intOrNull(num(ul.bytes));
  m.serverName = str(srv.name);
  m.serverLocation = [str(srv.location), str(srv.country)].filter(Boolean).join(", ") || null;
  m.serverHost = str(srv.host);
  m.isp = str(r.isp);
  m.externalIp = str(iface.externalIp, 64);
  m.resultUrl = str(res.url, 300);
  return m;
}

function parseSpeedtestCli(body: string): SpeedtestMeasure | string {
  const r = jsonObjects(body).find((o) => "download" in o && "upload" in o);
  if (!r) return "Output speedtest-cli tidak berisi hasil";
  const m = emptyMeasure("speedtest-cli");
  const srv = (r.server ?? {}) as Record<string, unknown>;
  const cl = (r.client ?? {}) as Record<string, unknown>;
  const dl = num(r.download);
  const ul = num(r.upload);
  m.downloadMbps = round(dl == null ? null : dl / 1e6);
  m.uploadMbps = round(ul == null ? null : ul / 1e6);
  m.pingMs = round(num(r.ping));
  m.bytesDown = intOrNull(num(r.bytes_received));
  m.bytesUp = intOrNull(num(r.bytes_sent));
  m.serverName = str(srv.sponsor);
  m.serverLocation = [str(srv.name), str(srv.country)].filter(Boolean).join(", ") || null;
  m.serverHost = str(srv.host);
  m.isp = str(cl.isp);
  m.externalIp = str(cl.ip, 64);
  m.resultUrl = str(r.share, 300);
  return m;
}

function parseCurl(body: string): SpeedtestMeasure | string {
  const m = emptyMeasure("curl");
  const pings: number[] = [];
  for (const line of body.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "__META__") {
      try {
        const meta = JSON.parse(line.trim().slice("__META__".length).trim() || "{}") as Record<string, unknown>;
        m.externalIp = str(meta.clientIp, 64);
        m.isp = str(meta.asOrganization);
        m.serverName = meta.colo ? `Cloudflare ${str(meta.colo)}` : "Cloudflare";
        m.serverLocation = [str(meta.city), str(meta.country)].filter(Boolean).join(", ") || null;
      } catch {
        /* meta opsional */
      }
    } else if (parts[0] === "__PING__") {
      const pre = num(parts[1]);
      const st = num(parts[2]);
      if (pre != null && st != null && st > 0 && parts[3]?.startsWith("2")) pings.push(Math.max(0, (st - pre) * 1000));
    } else if (parts[0] === "__DOWN__") {
      const bps = num(parts[1]);
      const size = num(parts[2]);
      if (bps && size && size > 100_000) {
        m.downloadMbps = round((bps * 8) / 1e6);
        m.bytesDown = intOrNull(size);
      }
    } else if (parts[0] === "__UP__") {
      const bps = num(parts[1]);
      const size = num(parts[2]);
      if (bps && size && size > 100_000) {
        m.uploadMbps = round((bps * 8) / 1e6);
        m.bytesUp = intOrNull(size);
      }
    }
  }
  if (pings.length) {
    // buang sampel pertama (DNS/TLS cold start) bila ada cukup sampel
    const p = pings.length > 3 ? pings.slice(1) : pings;
    const sorted = [...p].sort((a, b) => a - b);
    m.pingMs = round(sorted[Math.floor(sorted.length / 2)]);
    let jit = 0;
    for (let i = 1; i < p.length; i++) jit += Math.abs(p[i] - p[i - 1]);
    m.jitterMs = p.length > 1 ? round(jit / (p.length - 1)) : null;
  }
  m.serverHost = "speed.cloudflare.com";
  if (m.downloadMbps == null && m.uploadMbps == null) return "curl tidak berhasil mengunduh/mengunggah data uji (cek koneksi keluar ke speed.cloudflare.com)";
  return m;
}

/** Ubah output script remote menjadi hasil terukur, atau pesan error. */
export function parseSpeedtestOutput(stdout: string, stderr: string, code: number | null): SpeedtestMeasure | { error: string; missing?: boolean } {
  const missing = stdout.match(new RegExp(`${MISSING_MARK} (\\S+)`));
  if (missing) {
    const which = missing[1];
    const what = which === "all" ? "Tidak ada tool speedtest (Ookla, speedtest-cli, maupun curl)" : `Tool "${TOOL_LABEL[which] ?? which}" tidak terpasang`;
    return { error: `${what} di server.\n${INSTALL_HINT}`, missing: true };
  }
  const idx = stdout.indexOf(TOOL_MARK);
  if (idx < 0) {
    const tail = (stderr || stdout).trim().split("\n").slice(-5).join("\n");
    return { error: `Script speedtest tidak berjalan (exit ${code ?? "?"})${tail ? `: ${tail}` : ""}` };
  }
  const rest = stdout.slice(idx + TOOL_MARK.length);
  const nl = rest.indexOf("\n");
  const tool = rest.slice(0, nl < 0 ? undefined : nl).trim();
  const body = nl < 0 ? "" : rest.slice(nl + 1);
  const parsed = tool === "ookla" ? parseOokla(body + "\n" + stderr) : tool === "speedtest-cli" ? parseSpeedtestCli(body) : parseCurl(body);
  if (typeof parsed === "string") {
    const tail = stderr.trim().split("\n").filter((l) => !l.trim().startsWith("{")).slice(-4).join("\n");
    return { error: `${TOOL_LABEL[tool] ?? tool}: ${parsed}${tail ? `\n${tail}` : ""}${code ? ` (exit ${code})` : ""}` };
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Deteksi tool                                                         */
/* ------------------------------------------------------------------ */

export type DetectResult = { ookla: boolean; speedtestCli: boolean; curl: boolean; os: string | null };

export async function detectSpeedtestTools(sshId: string): Promise<DetectResult> {
  const row = await prisma.sshConnection.findUnique({ where: { id: sshId } });
  if (!row) throw new Error("Koneksi SSH tidak ditemukan");
  const client = await openClient(sshCfgFrom(row));
  try {
    const { stdout, stderr } = await execSplit(client, wrapScript(DETECT_SCRIPT), 30_000);
    const m = stdout.match(/__DETECT__ ookla=(\d) speedtest-cli=(\d) curl=(\d)/);
    if (!m) throw new Error(`Deteksi gagal: ${(stderr || stdout).trim().slice(0, 200) || "tidak ada output"}`);
    const os = stdout.match(/__OS__ (.*)/)?.[1]?.trim() || null;
    return { ookla: m[1] === "1", speedtestCli: m[2] === "1", curl: m[3] === "1", os };
  } finally {
    closeSsh(client);
  }
}

/* ------------------------------------------------------------------ */
/* Menjalankan job                                                      */
/* ------------------------------------------------------------------ */

const fmtMbps = (v: number | null | undefined) => (v == null ? "-" : `${v.toLocaleString("id-ID", { maximumFractionDigits: 1 })} Mbps`);

/**
 * Jalankan satu speedtest. Tidak pernah melempar — semua kegagalan dicatat ke
 * SpeedtestResult. Mengembalikan id hasil (atau null bila tidak dimulai).
 */
export async function runSpeedtestJob(jobId: string, trigger: "manual" | "scheduler" = "manual"): Promise<string | null> {
  if (runningJobs.has(jobId)) return null;
  const job = await prisma.speedtestJob.findUnique({ where: { id: jobId }, include: { ssh: true } }).catch(() => null);
  if (!job || !job.teamId || !job.ssh) {
    console.error(`[SPEEDTEST] Job ${jobId} tidak ditemukan`);
    return null;
  }
  if (busySsh.has(job.sshId)) return null; // server sedang diuji job lain — hasil akan bias
  runningJobs.add(jobId);
  busySsh.add(job.sshId);
  let resultId: string | null = null;
  let client: SshClient | null = null;
  try {
    const res = await prisma.speedtestResult.create({ data: { jobId, status: "running", trigger } });
    resultId = res.id;
    await prisma.speedtestJob.update({ where: { id: jobId }, data: { lastStatus: "running", lastRunAt: new Date() } });

    const tool = (SPEEDTEST_TOOLS as readonly string[]).includes(job.tool) ? (job.tool as SpeedtestTool) : "auto";
    const timeoutMs = Math.min(900, Math.max(30, job.timeoutSec || 180)) * 1000;
    client = await openClient(sshCfgFrom(job.ssh));
    const { code, stdout, stderr } = await execSplit(client, wrapScript(buildRunScript(tool, job.serverId)), timeoutMs);
    const parsed = parseSpeedtestOutput(stdout, stderr, code);

    if ("error" in parsed) {
      await prisma.speedtestResult.update({ where: { id: resultId }, data: { status: "failed", error: parsed.error.slice(0, 2000), endedAt: new Date() } });
      await prisma.speedtestJob.update({ where: { id: jobId }, data: { lastStatus: "failed" } });
      if (trigger === "scheduler") await notifyTeam(job.teamId, "error", `❌ Speedtest "${job.name}" GAGAL: ${parsed.error.split("\n")[0]}`);
      return resultId;
    }

    await prisma.speedtestResult.update({ where: { id: resultId }, data: { ...parsed, status: "success", endedAt: new Date() } });
    await prisma.speedtestJob.update({ where: { id: jobId }, data: { lastStatus: "success" } });
    if (trigger === "scheduler" && job.minDownloadMbps && parsed.downloadMbps != null && parsed.downloadMbps < job.minDownloadMbps) {
      await notifyTeam(
        job.teamId,
        "error",
        `⚠️ Speedtest "${job.name}": download ${fmtMbps(parsed.downloadMbps)} di bawah batas ${fmtMbps(job.minDownloadMbps)} (upload ${fmtMbps(parsed.uploadMbps)}, ping ${parsed.pingMs ?? "-"} ms).`,
      );
    }
    return resultId;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)) || "Kesalahan tidak diketahui";
    console.error(`[SPEEDTEST] Job "${job.name}" gagal: ${msg}`);
    if (resultId) {
      await prisma.speedtestResult.update({ where: { id: resultId }, data: { status: "failed", error: msg.slice(0, 2000), endedAt: new Date() } }).catch(() => {});
    }
    await prisma.speedtestJob.update({ where: { id: jobId }, data: { lastStatus: "failed" } }).catch(() => {});
    if (trigger === "scheduler") await notifyTeam(job.teamId, "error", `❌ Speedtest "${job.name}" GAGAL: ${msg}`).catch(() => {});
    return resultId;
  } finally {
    if (client) closeSsh(client);
    runningJobs.delete(jobId);
    busySsh.delete(job.sshId);
  }
}

const queue: { id: string; name: string }[] = [];
let queueRunning = false;

async function drainQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (queue.length) {
      const j = queue.shift()!;
      await runSpeedtestJob(j.id, "scheduler").catch((e) => console.error(`[SPEEDTEST] "${j.name}": ${(e as Error).message}`));
    }
  } finally {
    queueRunning = false;
  }
}

/**
 * Jalankan semua job terjadwal yang jatuh tempo menit ini. Dieksekusi berurutan
 * (satu per satu, lewat antrean) di latar belakang supaya pengujian tidak saling
 * berebut bandwidth.
 */
export async function runDueSpeedtests(now: Date = new Date()): Promise<string[]> {
  const jobs = await prisma.speedtestJob.findMany({
    where: { enabled: true, scheduleType: { not: "manual" } },
    select: { id: true, name: true, scheduleType: true, timeAt: true, dayOn: true, cronExpr: true, timezone: true },
  });
  const due = jobs.filter((j) => jobIsDue(j, now) && !queue.some((q) => q.id === j.id));
  if (!due.length) return [];
  queue.push(...due.map((j) => ({ id: j.id, name: j.name })));
  void drainQueue();
  return due.map((j) => j.name);
}

/** Tandai hasil "running" yang tertinggal (mis. proses restart) sebagai gagal. */
export async function cleanupStaleSpeedtests(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const r = await prisma.speedtestResult.updateMany({
    where: { status: "running", startedAt: { lt: cutoff } },
    data: { status: "failed", error: "Dihentikan: proses berhenti sebelum speedtest selesai", endedAt: new Date() },
  });
  await prisma.speedtestJob.updateMany({ where: { lastStatus: "running", lastRunAt: { lt: cutoff } }, data: { lastStatus: "failed" } });
  return r.count;
}
