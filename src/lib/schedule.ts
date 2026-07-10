// Schedule = a list of weekly actions ("on Mon,Tue at 08:00 → start").
// Desired state at any moment = whatever the most recently passed action says.
// Evaluated in the schedule's own timezone; the week wraps around.

export interface Action {
  days: string; // comma-separated 0-6 (0=Sunday)
  time: string; // "HH:MM"
  action: string; // "start" | "stop"
}

export interface ScheduleInput {
  enabled: boolean;
  timezone: string;
  actions: Action[];
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Current weekday (0-6) and minutes-since-midnight in a given IANA timezone. */
export function localParts(now: Date, timezone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  let weekday = 0;
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "weekday") weekday = WEEKDAY_INDEX[p.value] ?? 0;
    else if (p.type === "hour") hour = parseInt(p.value, 10) % 24;
    else if (p.type === "minute") minute = parseInt(p.value, 10);
  }
  return { weekday, minutes: hour * 60 + minute };
}

function parseTime(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Desired power state from the action list: the action most recently passed
 * (wrapping to the previous week) decides. Returns null when the schedule is
 * disabled or has no valid actions.
 */
export function desiredState(schedule: ScheduleInput, now: Date = new Date()): "running" | "stopped" | null {
  if (!schedule.enabled || schedule.actions.length === 0) return null;

  // Expand every action×day into an absolute minute-of-week.
  const points: { at: number; action: string }[] = [];
  for (const a of schedule.actions) {
    const t = parseTime(a.time);
    if (t === null) continue;
    for (const d of a.days.split(",")) {
      const day = Number(d.trim());
      if (!Number.isInteger(day) || day < 0 || day > 6) continue;
      points.push({ at: day * 1440 + t, action: a.action });
    }
  }
  if (points.length === 0) return null;
  points.sort((x, y) => x.at - y.at);

  const { weekday, minutes } = localParts(now, schedule.timezone);
  const nowAbs = weekday * 1440 + minutes;

  // Most recent point at/before now; if now is before the first point of the
  // week, wrap around to the week's last point (i.e. previous week's action).
  let current = points[points.length - 1];
  for (const p of points) {
    if (p.at <= nowAbs) current = p;
    else break;
  }
  return current.action === "start" ? "running" : "stopped";
}
