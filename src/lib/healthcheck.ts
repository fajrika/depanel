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
