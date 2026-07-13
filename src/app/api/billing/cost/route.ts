import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";
import { desiredState, type Action } from "@/lib/schedule";

/** Fraction of the week a schedule keeps the server STOPPED (0..1), sampled every 30 min. */
function offFraction(sched: { enabled: boolean; timezone: string; actions: Action[] }): number {
  if (!sched.enabled || sched.actions.length === 0) return 0;
  const base = new Date(Date.UTC(2024, 0, 1, 0, 0, 0)); // a Monday 00:00 UTC reference week
  let off = 0;
  const steps = 7 * 48; // 30-min steps
  for (let i = 0; i < steps; i++) {
    const t = new Date(base.getTime() + i * 30 * 60 * 1000);
    if (desiredState(sched, t) === "stopped") off++;
  }
  return off / steps;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);

  const servers = await prisma.server.findMany({
    where: { account: { teamId: team.id } },
    include: { schedule: { include: { actions: true } } },
  });

  const WEEKS_PER_MONTH = 730 / 168; // ~4.345
  let monthlyList = 0; // total list price if always on
  let monthlySaving = 0; // saved by scheduling off-hours
  const rows = servers.map((s) => {
    let pricePerHour = 0;
    let estMonthly = 0;
    try {
      const d = s.detailJson ? (JSON.parse(s.detailJson) as { price_per_hour?: number; estimated_monthly_price?: number }) : {};
      pricePerHour = d.price_per_hour ?? 0;
      estMonthly = d.estimated_monthly_price ?? pricePerHour * 730;
    } catch {
      /* no cached detail */
    }
    const off = s.managed && s.schedule ? offFraction({ enabled: s.schedule.enabled, timezone: s.schedule.timezone, actions: s.schedule.actions as unknown as Action[] }) : 0;
    const saving = off * pricePerHour * 168 * WEEKS_PER_MONTH; // off-hours/week × price × weeks
    monthlyList += estMonthly;
    monthlySaving += saving;
    return {
      id: s.id,
      hostname: s.hostname,
      account: s.accountId,
      pricePerHour,
      estMonthly,
      scheduled: off > 0,
      offPercent: Math.round(off * 100),
      monthlySaving: Math.round(saving),
    };
  });

  return NextResponse.json({
    ok: true,
    data: {
      team: { id: team.id, name: team.name },
      monthlyList: Math.round(monthlyList),
      monthlySaving: Math.round(monthlySaving),
      monthlyNet: Math.round(monthlyList - monthlySaving),
      servers: rows.sort((a, b) => b.estMonthly - a.estMonthly),
    },
  });
}
