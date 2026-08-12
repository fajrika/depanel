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
 * Statistik gaya Uptime Kuma: strip kotak 24 jam (per jam) + 30 hari (per hari)
 * + uptime % 24 jam / 7 hari / 30 hari.
 */
export async function getHealthStats(checkId: string): Promise<{
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  hours24: { label: string; pct: number | null; ok: boolean | null }[];
  days30: { label: string; pct: number | null; ok: boolean | null }[];
}> {
  const now = Date.now();
  const since = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const samples = await prisma.healthCheckSample.findMany({
    where: { checkId, at: { gte: since } },
    select: { at: true, ok: true },
  });

  const uptime = (ms: number): number | null => {
    const list = samples.filter((s) => s.at.getTime() >= now - ms);
    if (!list.length) return null;
    const up = list.filter((s) => s.ok).length;
    return Math.round((up / list.length) * 1000) / 10;
  };

  // 24 bucket per jam (jam mulai = jam saat ini - 23 … sekarang)
  const hours24: PillBucket[] = [];
  for (let i = 23; i >= 0; i--) {
    const start = now - i * 60 * 60 * 1000;
    const end = start + 60 * 60 * 1000;
    const list = samples.filter((s) => s.at.getTime() >= start && s.at.getTime() < end);
    const pct = list.length ? Math.round((list.filter((s) => s.ok).length / list.length) * 100) : null;
    const d = new Date(start);
    hours24.push({ label: `${String(d.getHours()).padStart(2, "0")}:00`, pct, ok: pctToState(pct) === "up" ? true : pctToState(pct) === "down" ? false : null });
  }

  // 30 bucket per hari (hari mulai = hari ini - 29 … hari ini)
  const days30: PillBucket[] = [];
  for (let i = 29; i >= 0; i--) {
    const start = new Date(now - i * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);
    const end = start.getTime() + 24 * 60 * 60 * 1000;
    const list = samples.filter((s) => s.at.getTime() >= start.getTime() && s.at.getTime() < end);
    const pct = list.length ? Math.round((list.filter((s) => s.ok).length / list.length) * 100) : null;
    days30.push({ label: `${String(start.getDate()).padStart(2, "0")}/${String(start.getMonth() + 1).padStart(2, "0")}`, pct, ok: pctToState(pct) === "up" ? true : pctToState(pct) === "down" ? false : null });
  }

  return {
    uptime24h: uptime(24 * 60 * 60 * 1000),
    uptime7d: uptime(7 * 24 * 60 * 60 * 1000),
    uptime30d: uptime(30 * 24 * 60 * 60 * 1000),
    hours24,
    days30,
  };
}
