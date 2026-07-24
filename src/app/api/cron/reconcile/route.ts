import { NextResponse } from "next/server";
import { reconcileAll, logActivity } from "@/lib/power";

/**
 * Server power schedule reconciler endpoint.
 * Call this every minute via external cron:
 *   * * * * * curl -s "https://your-domain/api/cron/reconcile?key=YOUR_SECRET"
 *
 * Checks all managed servers with enabled schedules and starts/stops them as needed.
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
  console.log(`[RECONCILE] Running at ${now.toISOString()}`);
  const actions = await reconcileAll(now);
  if (actions.length > 0) {
    await logActivity({ action: "reconcile-now", source: "scheduler", message: `auto-reconcile: ${actions.length} aksi` });
  }
  console.log(`[RECONCILE] Took ${actions.length} action(s): ${actions.map((a) => `${a.hostname}→${a.action}(${a.ok ? "ok" : a.message})`).join(", ") || "none"}`);

  return NextResponse.json({ ok: true, actions, timestamp: now.toISOString() });
}
