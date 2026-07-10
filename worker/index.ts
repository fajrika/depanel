// Standalone scheduler worker. Runs independently of the Next.js web process.
// - Every 5 minutes: reconcile managed servers to their on/off schedule.
// - Every minute: run MySQL backup jobs that are due.
process.loadEnvFile(".env");
import cron from "node-cron";
import { reconcileAll } from "../src/lib/power";
import { runDueJobs } from "../src/lib/dbbackup";

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

console.log(`🕒 Depa scheduler worker aktif. Reconcile: "${CRON}" · Backup DB: tiap menit.`);
runOnce("startup");
cron.schedule(CRON, () => runOnce("tick"));
cron.schedule("* * * * *", () => checkDbBackups());
