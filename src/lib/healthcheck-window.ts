// Jendela waktu aktif health check ("jam operasional").
// - mode "always": selalu dicek (perilaku lama, default)
// - mode "only":   hanya dicek di dalam [start, end)  — mis. 05:00–21:00
// - mode "skip":   tidak dicek di dalam [start, end)  — mis. 22:00–04:00
// Jendela boleh melewati tengah malam (end <= start). Dievaluasi di zona waktu
// milik check (default Asia/Jakarta). Sampel di luar jendela aktif tidak ikut
// dihitung ke persentase uptime.
// Pure & worker-safe: tanpa Prisma / Next.js.

export type HealthWindowMode = "always" | "only" | "skip";

export interface HealthWindow {
  scheduleMode?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  timezone?: string | null;
}

export const DEFAULT_HEALTH_TZ = "Asia/Jakarta";

export function parseHHMM(t: string | null | undefined): number | null {
  const m = (t ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Normalisasi config; null bila jendela tidak berlaku (selalu aktif). */
function normalize(w: HealthWindow): { mode: "only" | "skip"; start: number; end: number; tz: string } | null {
  const mode = w.scheduleMode;
  if (mode !== "only" && mode !== "skip") return null;
  const start = parseHHMM(w.windowStart);
  const end = parseHHMM(w.windowEnd);
  if (start === null || end === null || start === end) return null;
  const tz = w.timezone && isValidTimezone(w.timezone) ? w.timezone : DEFAULT_HEALTH_TZ;
  return { mode, start, end, tz };
}

// Offset zona waktu (menit) di-cache per jam UTC — cukup akurat (DST berganti
// di batas jam) dan jauh lebih cepat untuk puluhan ribu sampel.
const fmtCache = new Map<string, Intl.DateTimeFormat>();
const offsetCache = new Map<string, number>();

function tzOffsetMinutes(ms: number, tz: string): number {
  const hourKey = Math.floor(ms / 3_600_000);
  const key = `${tz}|${hourKey}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    fmtCache.set(tz, fmt);
  }
  const at = hourKey * 3_600_000;
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(at))) {
    if (part.type !== "literal") p[part.type] = parseInt(part.value, 10);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute);
  const off = Math.round((asUtc - at) / 60_000);
  if (offsetCache.size > 20_000) offsetCache.clear();
  offsetCache.set(key, off);
  return off;
}

/** Menit-sejak-tengah-malam di zona waktu `tz`. */
export function localMinuteOfDay(date: Date | number, tz: string): number {
  const ms = typeof date === "number" ? date : date.getTime();
  const local = ms + tzOffsetMinutes(ms, tz) * 60_000;
  return ((Math.floor(local / 60_000) % 1440) + 1440) % 1440;
}

/** Nomor hari kalender lokal (hari sejak epoch) untuk timestamp di `tz`. */
export function localDayIndex(date: Date | number, tz: string): number {
  const ms = typeof date === "number" ? date : date.getTime();
  return Math.floor((ms + tzOffsetMinutes(ms, tz) * 60_000) / 86_400_000);
}

function inRange(min: number, start: number, end: number): boolean {
  return start < end ? min >= start && min < end : min >= start || min < end;
}

/** Apakah check harus aktif (dicek & dihitung uptime) pada waktu `date`. */
export function isWithinActiveWindow(w: HealthWindow, date: Date | number = Date.now()): boolean {
  const n = normalize(w);
  if (!n) return true;
  const inside = inRange(localMinuteOfDay(date, n.tz), n.start, n.end);
  return n.mode === "only" ? inside : !inside;
}

/** Pembuat predikat cepat untuk memfilter banyak sampel sekaligus. */
export function activeWindowFilter(w: HealthWindow): (date: Date | number) => boolean {
  const n = normalize(w);
  if (!n) return () => true;
  return (date) => {
    const inside = inRange(localMinuteOfDay(date, n.tz), n.start, n.end);
    return n.mode === "only" ? inside : !inside;
  };
}

/** Teks ringkas untuk UI/laporan, mis. "Hanya 05:00-21:00 (Asia/Jakarta)". */
export function describeWindow(w: HealthWindow): string {
  const n = normalize(w);
  if (!n) return "Selalu (24 jam)";
  const s = `${w.windowStart}-${w.windowEnd}`;
  return n.mode === "only" ? `Hanya ${s} (${n.tz})` : `Jeda ${s} (${n.tz})`;
}

/** Menit aktif per hari (untuk info "x jam/hari"). */
export function activeMinutesPerDay(w: HealthWindow): number {
  const n = normalize(w);
  if (!n) return 1440;
  const len = n.start < n.end ? n.end - n.start : 1440 - n.start + n.end;
  return n.mode === "only" ? len : 1440 - len;
}
