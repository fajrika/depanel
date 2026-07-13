// Standalone scheduler worker. Runs independently of the Next.js web process.
// - Every 5 minutes: reconcile managed servers to their on/off schedule.
// - Every minute: run MySQL backup jobs that are due.
// Local dev reads .env; in containers env vars are injected (no file), so this is best-effort.
try {
  process.loadEnvFile(".env");
} catch {
  /* no .env file (e.g. Docker) — rely on process.env */
}
import cron from "node-cron";
import { reconcileAll } from "../src/lib/power";
import { runDueJobs } from "../src/lib/dbbackup";
import { runAlertChecks } from "../src/lib/alerts";
import { sampleAllMetrics } from "../src/lib/metrics";

const CRON = process.env.RECONCILE_CRON || "*/5 * * * *"; // every 5 minutes

async function runOnce(reason: string) {
  const start = Date.now();
  try {
    const actions = await reconcileAll();
    const changed = actions.filter((a) => a.ok);
    console.log(
      `[${new Date().toISOString()}] reconcile (${reason}) — ${actions.length} aksi, ${changed.length} berhasil` +
        (actions.length ? ": " + actions.map((a) => `${a.action} ${a.hostname}${a.ok ? "" : " [GAGAL]"}`).join(", ") : ""),
      `(${Date.now() - start}ms)`
    );
  } catch (e) {
    console.error(`[${new Date().toISOString()}] reconcile error:`, (e as Error).message);
  }
}

async function checkDbBackups() {
  try {
    const started = await runDueJobs();
    if (started.length) {
      console.log(`[${new Date().toISOString()}] backup DB dimulai: ${started.join(", ")}`);
    }
  } catch (e) {
    console.error(`[${new Date().toISOString()}] backup DB error:`, (e as Error).message);
  }
}

async function checkAlerts() {
  try {
    await runAlertChecks();
  } catch (e) {
    console.error(`[${new Date().toISOString()}] alert check error:`, (e as Error).message);
  }
}

async function sampleMetrics() {
  try {
    const n = await sampleAllMetrics();
    if (n) console.log(`[${new Date().toISOString()}] metrik tersampel: ${n} server`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] metric sample error:`, (e as Error).message);
  }
}

console.log(`🕒 Depa scheduler worker aktif. Reconcile: "${CRON}" · Backup DB: tiap menit · Alert & metrik: tiap 15 menit.`);
runOnce("startup");
cron.schedule(CRON, () => runOnce("tick"));
cron.schedule("* * * * *", () => checkDbBackups());
cron.schedule("*/15 * * * *", () => checkAlerts());
cron.schedule("*/15 * * * *", () => sampleMetrics());
