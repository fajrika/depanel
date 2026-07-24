import { NextResponse } from "next/server";
import { runDueJobs } from "@/lib/dbbackup";

/**
 * Backup scheduler endpoint.
 * Call this every minute via external cron (e.g. crontab: * * * * * curl https://your-domain/api/cron/backup-scheduler?key=YOUR_SECRET)
 *
 * Runs all enabled backup jobs whose schedule matches the current time.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json({ ok: false, message: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (key !== secret) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  console.log(`[SCHEDULER] Running at ${now.toISOString()}`);
  const started = await runDueJobs(now);
  console.log(`[SCHEDULER] Started ${started.length} job(s): ${started.join(", ") || "(none)"}`);

  return NextResponse.json({ ok: true, started, timestamp: now.toISOString() });
}
