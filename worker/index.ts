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
import { runDueCloneJobs } from "../src/lib/dirclone";
import { checkDueHealthChecks } from "../src/lib/healthcheck";
import { runDueSshCommandJobs } from "../src/lib/sshcmd";
import { checkDueSshHealth } from "../src/lib/sshhealth";
import { runDueScheduledReports } from "../src/lib/schedreport";
import { runAlertChecks } from "../src/lib/alerts";
import { sampleAllMetrics } from "../src/lib/metrics";
import { sampleAllSshMetrics } from "../src/lib/sshmon";

const CRON = process.env.RECONCILE_CRON || "*/5 * * * *"; // every 5 minutes

// Reconcile bisa berjalan lama (sync depa API sekuensial, bisa 1-2 menit).
// Jangan biarkan tick berikutnya menumpuk — lewati bila sesi masih berjalan.
let reconcileBusy = false;

async function runOnce(reason: string) {
  if (reconcileBusy) {
    console.log(`[${new Date().toISOString()}] reconcile dilewati — sesi sebelumnya masih berjalan (${reason})`);
    return;
  }
  reconcileBusy = true;
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
  } finally {
    reconcileBusy = false;
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

async function checkDirClones() {
  try {
    const started = await runDueCloneJobs();
    if (started.length) {
      console.log(`[${new Date().toISOString()}] clone direktori dimulai: ${started.join(", ")}`);
    }
  } catch (e) {
    console.error(`[${new Date().toISOString()}] clone direktori error:`, (e as Error).message);
  }
}

async function checkHealth() {
  try {
    const n = await checkDueHealthChecks();
    if (n) console.log(`[${new Date().toISOString()}] health check dijalankan: ${n} target`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] health check error:`, (e as Error).message);
  }
}

async function checkSshCmds() {
  try {
    const started = await runDueSshCommandJobs();
    if (started.length) {
      console.log(`[${new Date().toISOString()}] SSH script dimulai: ${started.join(", ")}`);
    }
  } catch (e) {
    console.error(`[${new Date().toISOString()}] SSH script error:`, (e as Error).message);
  }
}

async function checkSshHealthAll() {
  try {
    const n = await checkDueSshHealth();
    if (n) console.log(`[${new Date().toISOString()}] app health dicek: ${n} target`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] app health error:`, (e as Error).message);
  }
}

async function checkReports() {
  try {
    const started = await runDueScheduledReports();
    if (started.length) {
      console.log(`[${new Date().toISOString()}] laporan terjadwal dikirim: ${started.join(", ")}`);
    }
  } catch (e) {
    console.error(`[${new Date().toISOString()}] laporan terjadwal error:`, (e as Error).message);
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

async function sampleSsh() {
  try {
    const n = await sampleAllSshMetrics();
    if (n) console.log(`[${new Date().toISOString()}] metrik SSH tersampel: ${n} koneksi`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] SSH metric sample error:`, (e as Error).message);
  }
}

console.log(`🕒 Depa scheduler worker aktif. Reconcile: "${CRON}" · Backup DB/clone/health/SSH script/app health/laporan: tiap menit · Alert & metrik: tiap 15 menit.`);
runOnce("startup");
cron.schedule(CRON, () => runOnce("tick"));
cron.schedule("* * * * *", () => checkDbBackups());
cron.schedule("* * * * *", () => checkDirClones());
cron.schedule("* * * * *", () => checkHealth());
cron.schedule("* * * * *", () => checkSshCmds());
cron.schedule("* * * * *", () => checkSshHealthAll());
cron.schedule("* * * * *", () => checkReports());
// di-offset agar alert, metrik depa, dan metrik SSH tidak menulis DB di menit yang sama
cron.schedule("1-59/15 * * * *", () => checkAlerts());
cron.schedule("2-59/15 * * * *", () => sampleMetrics());
cron.schedule("3-59/15 * * * *", () => sampleSsh());
