// Health check engine: probe an HTTP endpoint periodically and store samples.
// Worker-safe: no "server-only", no Next.js imports.
import { prisma } from "./db";
import { notifyTeam } from "./notify";

const SAMPLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

/**
 * Probe satu health check: fetch URL dengan timeout, catat sampel, perbarui
 * status, dan kirim notifikasi hanya saat status berubah (up→down / down→up).
 */
export async function checkHealthCheck(
  id: string,
  trigger: "manual" | "scheduler" = "scheduler",
): Promise<{ ok: boolean; statusCode?: number | null; latencyMs?: number; error?: string | null }> {
  const hc = await prisma.healthCheck.findUnique({ where: { id } });
  if (!hc) return { ok: false, error: "Health check tidak ditemukan" };

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), (hc.timeoutSec || 10) * 1000);

  let ok = false;
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(hc.url, {
      method: hc.method || "GET",
      signal: ctrl.signal,
      redirect: "follow",
      cache: "no-store",
    });
    statusCode = res.status;
    ok = res.status === (hc.expectedStatus || 200);
    if (!ok) error = `status ${res.status} (diharapkan ${hc.expectedStatus})`;
  } catch (e) {
    error = (e as Error).message.slice(0, 300);
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - started;

  const prev = hc.lastStatus;
  const now = new Date();
  await prisma.$transaction([
    prisma.healthCheckSample.create({
      data: { checkId: id, ok, statusCode, latencyMs, error },
    }),
    prisma.healthCheck.update({
      where: { id },
      data: {
        lastStatus: ok ? "up" : "down",
        lastLatencyMs: latencyMs,
        lastCheckAt: now,
        lastUpAt: ok ? now : hc.lastUpAt,
      },
    }),
  ]);

  if (ok && prev !== "up") {
    await notifyTeam(hc.teamId, "error", `🟢 Health check "${hc.name}" kembali normal (${latencyMs}ms).`);
  } else if (!ok && prev !== "down") {
    await notifyTeam(hc.teamId, "error", `🔴 Health check "${hc.name}" DOWN${error ? `: ${error}` : ""}`);
  }

  return { ok, statusCode, latencyMs, error };
}

/** Jalankan semua health check yang sudah jatuh tempo intervalnya. */
export async function checkDueHealthChecks(now: Date = new Date()): Promise<number> {
  const checks = await prisma.healthCheck.findMany({ where: { enabled: true } });
  let started = 0;
  for (const c of checks) {
    const due = !c.lastCheckAt || now.getTime() - c.lastCheckAt.getTime() >= (c.intervalMin || 1) * 60_000;
    if (due) {
      started++;
      void checkHealthCheck(c.id).catch((e) => {
        console.error(`[HEALTH] Cek "${c.name}" gagal: ${(e as Error).message}`);
      });
    }
  }

  // retensi sampel
  const cutoff = new Date(now.getTime() - SAMPLE_RETENTION_MS);
  await prisma.healthCheckSample.deleteMany({ where: { at: { lt: cutoff } } });
  return started;
}

/** Uptime % + deret sampel untuk satu health check dalam `hours` terakhir. */
export async function getHealthHistory(checkId: string, hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const samples = await prisma.healthCheckSample.findMany({
    where: { checkId, at: { gte: since } },
    orderBy: { at: "asc" },
    select: { at: true, ok: true, statusCode: true, latencyMs: true, error: true },
  });
  const total = samples.length;
  const up = samples.filter((s) => s.ok).length;
  return {
    uptimePct: total ? Math.round((up / total) * 1000) / 10 : null,
    samples: samples.slice(-200).map((s) => ({
      t: s.at.toISOString(),
      ok: s.ok,
      statusCode: s.statusCode,
      latencyMs: s.latencyMs,
      error: s.error,
    })),
  };
}

type PillBucket = { label: string; pct: number | null; ok: boolean | null };

function pctToState(pct: number | null): "up" | "down" | "partial" | "none" {
  if (pct === null) return "none";
  if (pct >= 100) return "up";
  if (pct <= 0) return "down";
  return "partial";
}

/**
 * Statistik gaya Uptime Kuma: strip 24 pengecekan terakhir + 30 hari (per hari,
 * bisa digeser via offsetDays) + uptime % + sampel mentah untuk mode expand.
 */
export async function getHealthStats(
  checkId: string,
  opts: { offsetDays?: number } = {},
): Promise<{
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  last24: { label: string; pct: number | null; ok: boolean | null }[];
  days30: { label: string; pct: number | null; ok: boolean | null }[];
  rangeStart: string;
  rangeEnd: string;
  samples24: { t: string; ok: boolean; latencyMs: number | null }[];
  samples30: { t: string; ok: boolean; latencyMs: number | null }[];
}> {
  const offsetDays = opts.offsetDays || 0;
  const now = Date.now();
  const since = new Date(now - (30 + offsetDays) * 24 * 60 * 60 * 1000);
  const samples = await prisma.healthCheckSample.findMany({
    where: { checkId, at: { gte: since } },
    select: { at: true, ok: true, latencyMs: true },
  });

  // 24 pengecekan terakhir (bukan agregat per jam)
  const lastSamples = await prisma.healthCheckSample.findMany({
    where: { checkId },
    orderBy: { at: "desc" },
    take: 24,
    select: { at: true, ok: true },
  });
  const last24: PillBucket[] = lastSamples
    .reverse()
    .map((s) => ({
      label: new Date(s.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      pct: s.ok ? 100 : 0,
      ok: s.ok,
    }));

  const uptime = (ms: number): number | null => {
    const list = samples.filter((s) => s.at.getTime() >= now - ms);
    if (!list.length) return null;
    const up = list.filter((s) => s.ok).length;
    return Math.round((up / list.length) * 1000) / 10;
  };

  // rentang 30 hari untuk periode aktif (offsetDays = 0 → 30 hari terakhir)
  const rangeEndMs = now - offsetDays * 24 * 60 * 60 * 1000;
  const rangeStartMs = rangeEndMs - 30 * 24 * 60 * 60 * 1000;

  // 30 bucket per hari
  const days30: PillBucket[] = [];
  for (let i = 29; i >= 0; i--) {
    const start = new Date(rangeEndMs - i * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);
    const end = start.getTime() + 24 * 60 * 60 * 1000;
    const list = samples.filter((s) => s.at.getTime() >= start.getTime() && s.at.getTime() < end);
    const pct = list.length ? Math.round((list.filter((s) => s.ok).length / list.length) * 100) : null;
    days30.push({ label: `${String(start.getDate()).padStart(2, "0")}/${String(start.getMonth() + 1).padStart(2, "0")}`, pct, ok: pctToState(pct) === "up" ? true : pctToState(pct) === "down" ? false : null });
  }

  const mapSample = (s: { at: Date; ok: boolean; latencyMs: number | null }) => ({
    t: s.at.toISOString(),
    ok: s.ok,
    latencyMs: s.latencyMs,
  });

  // sampel mentah untuk mode expand
  const samples24 = samples
    .filter((s) => s.at.getTime() >= now - 24 * 60 * 60 * 1000)
    .map(mapSample);
  const samples30 = samples
    .filter((s) => s.at.getTime() >= rangeStartMs && s.at.getTime() < rangeEndMs)
    .map(mapSample)
    .reverse()
    .slice(0, 1500);

  return {
    uptime24h: uptime(24 * 60 * 60 * 1000),
    uptime7d: uptime(7 * 24 * 60 * 60 * 1000),
    uptime30d: uptime(30 * 24 * 60 * 60 * 1000),
    last24,
    days30,
    rangeStart: new Date(rangeStartMs).toISOString(),
    rangeEnd: new Date(rangeEndMs).toISOString(),
    samples24,
    samples30,
  };
}
