"use client";

import { useMemo, useRef, useState } from "react";

export type Series = {
  label: string;
  color: string; // css color for line
  fill?: string; // css color for area fill
  points: { t: string; v: number }[];
};

const W = 600;
const H = 180;
const PAD = 6;

function fmtDefault(v: number): string {
  if (v >= 1000) return v.toLocaleString("id-ID", { maximumFractionDigits: 0 });
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export default function MetricChart({
  title,
  series,
  yMax,
  format = fmtDefault,
  subtitle,
}: {
  title: string;
  series: Series[];
  /** fixed y-axis max (e.g. 100 for CPU%); otherwise auto */
  yMax?: number;
  format?: (v: number) => string;
  subtitle?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const n = Math.max(...series.map((s) => s.points.length), 0);
  const max = useMemo(() => {
    const dataMax = Math.max(...series.flatMap((s) => s.points.map((p) => p.v)), 0);
    const m = yMax ?? dataMax * 1.15;
    return m <= 0 ? 1 : m;
  }, [series, yMax]);

  const x = (i: number) => PAD + (i / Math.max(n - 1, 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (Math.min(v, max) / max) * (H - PAD * 2);

  function pathFor(pts: { v: number }[], close: boolean): string {
    if (!pts.length) return "";
    let d = `M ${x(0)} ${y(pts[0].v)}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${x(i)} ${y(pts[i].v)}`;
    if (close) d += ` L ${x(pts.length - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`;
    return d;
  }

  function onMove(e: React.MouseEvent) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const rel = (e.clientX - rect.left) / rect.width;
    setHoverIdx(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  }

  const times = series[0]?.points ?? [];
  const stats = series.map((s) => {
    const vs = s.points.map((p) => p.v);
    const last = vs.at(-1) ?? 0;
    const avg = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
    return { ...s, last, avg, peak: vs.length ? Math.max(...vs) : 0 };
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap gap-4">
          {stats.map((s) => (
            <div key={s.label} className="text-right">
              <p className="flex items-center justify-end gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </p>
              <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                {format(hoverIdx !== null ? (s.points[hoverIdx]?.v ?? 0) : s.last)}
              </p>
              <p className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
                rata² {format(s.avg)} · puncak {format(s.peak)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div
        ref={ref}
        className="relative mt-3 cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full">
          {/* grid lines */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="4 4" />
          ))}
          {series.map((s) => (
            <g key={s.label}>
              {s.fill && <path d={pathFor(s.points, true)} fill={s.fill} />}
              <path d={pathFor(s.points, false)} fill="none" stroke={s.color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </g>
          ))}
          {hoverIdx !== null && n > 0 && (
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD} y2={H - PAD} className="stroke-slate-400 dark:stroke-slate-500" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {hoverIdx !== null && times[hoverIdx] && (
          <span className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded bg-slate-800 px-2 py-0.5 text-[10px] text-white">
            {times[hoverIdx].t}
          </span>
        )}
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{times[0]?.t ?? ""}</span>
        <span>{times[Math.floor((n - 1) / 2)]?.t ?? ""}</span>
        <span>{times.at(-1)?.t ?? ""}</span>
      </div>
    </div>
  );
}
