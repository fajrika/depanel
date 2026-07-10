"use client";

// Simple, scroll-free time picker: hour + minute dropdowns (5-minute steps).
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

export default function TimeField({
  value,
  onChange,
  className = "",
}: {
  value: string; // "HH:MM"
  onChange: (v: string) => void;
  className?: string;
}) {
  const [h = "08", m = "00"] = value.split(":");
  const selCls =
    "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums outline-none focus:border-slate-900 " +
    "dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <select value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)} className={selCls} aria-label="Jam">
        {HOURS.map((x) => (
          <option key={x} value={x}>{x}</option>
        ))}
      </select>
      <span className="text-slate-400">:</span>
      <select
        value={MINUTES.includes(m) ? m : "00"}
        onChange={(e) => onChange(`${h}:${e.target.value}`)}
        className={selCls}
        aria-label="Menit"
      >
        {MINUTES.map((x) => (
          <option key={x} value={x}>{x}</option>
        ))}
      </select>
    </span>
  );
}
