"use client";

// Grafik garis/batang ringan (SVG) untuk blok laporan "chart" dan halaman Speedtest.
// Bentuk props sama dengan ReportBlock { type: "chart" } supaya preview HTML dan PDF
// menampilkan grafik yang sama.
import { useMemo, useRef, useState } from "react";

export type ChartSeries = { name: string; color: string; values: (number | null)[] };
export type ChartSpec = {
  chart: "line" | "bar";
  title?: string;
  labels: string[];
  series: ChartSeries[];
  unit?: string;
  height?: number;
  caption?: string;
  zeroBased?: boolean;
};
export type StatItem = { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" | "neutral" };

const W = 640;
const AXIS_W = 44;
const PAD_T = 18;
const PAD_B = 22;

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return `${Math.round(v / 100) / 10}k`;
  if (a >= 10 || v === 0) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

function fmtVal(v: number | null | undefined, unit?: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v.toLocaleString("id-ID", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2 });
  return unit ? `${s} ${unit}` : s;
}

export default function ReportChart({ spec, compact = false }: { spec: ChartSpec; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const H = (spec.height ?? (compact ? 140 : 170)) + PAD_T + PAD_B;
  const plotH = H - PAD_T - PAD_B;
  const pw = W - AXIS_W - 6;
  const n = spec.labels.length;
  const series = spec.series.filter((s) => s.values.some((v) => v != null && Number.isFinite(v)));

  const scale = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v != null && Number.isFinite(v)));
    if (!all.length) return null;
    const zero = spec.zeroBased !== false;
    let lo = zero ? Math.min(0, ...all) : Math.min(...all);
    let hi = Math.max(...all);
    if (hi === lo) {
      hi = hi + (Math.abs(hi) || 1);
      if (!zero) lo -= 1;
    }
    const step = niceStep((hi - lo) / 4);
    hi = Math.ceil(hi / step) * step;
    lo = zero ? Math.min(0, Math.floor(lo / step) * step) : Math.floor(lo / step) * step;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    return { lo, hi, ticks };
  }, [series, spec.zeroBased]);

  const yOf = (v: number) => (scale ? PAD_T + plotH - ((v - scale.lo) / (scale.hi - scale.lo)) * plotH : 0);
  const gw = n ? pw / n : pw;
  const xOf = (i: number) => (spec.chart === "bar" ? AXIS_W + i * gw + gw / 2 : n <= 1 ? AXIS_W + pw / 2 : AXIS_W + 4 + (i / (n - 1)) * (pw - 8));

  function onMove(e: React.MouseEvent) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !n) return;
    const xs = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xOf(i) - xs);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    setHover(best);
  }

  const longest = Math.max(1, ...spec.labels.map((l) => l.length));
  const maxLabels = Math.max(2, Math.floor(pw / Math.max(48, longest * 6 + 14)));
  const every = Math.max(1, Math.ceil(n / maxLabels));
  const k = Math.max(1, series.length);
  const bw = Math.max(1, Math.min(22, (gw * 0.78) / k));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {spec.title && <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200">{spec.title}</h4>}
        {series.length > 1 && (
          <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            {series.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={spec.title}>
          {!scale ? (
            <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-slate-400 text-[12px]">
              Tidak ada data
            </text>
          ) : (
            <>
              {scale.ticks.map((v) => (
                <g key={v}>
                  <line x1={AXIS_W} x2={W - 6} y1={yOf(v)} y2={yOf(v)} className="stroke-slate-100 dark:stroke-slate-800" strokeWidth={1} />
                  <text x={AXIS_W - 6} y={yOf(v) + 3.5} textAnchor="end" className="fill-slate-400 text-[10px]">
                    {fmtAxis(v)}
                  </text>
                </g>
              ))}
              {spec.unit && (
                <text x={2} y={2} className="fill-slate-400 text-[10px]" dominantBaseline="hanging">
                  {spec.unit}
                </text>
              )}
              {spec.chart === "bar"
                ? series.map((s, si) =>
                    s.values.map((v, i) => {
                      if (v == null || !Number.isFinite(v)) return null;
                      const x = AXIS_W + i * gw + (gw - bw * k) / 2 + si * bw;
                      const y0 = yOf(Math.max(scale.lo, 0));
                      const y1 = yOf(v);
                      const h = Math.max(1, Math.abs(y0 - y1));
                      const w = Math.max(1, bw - (k > 1 ? 2 : 1));
                      const r = Math.min(4, w / 2, h);
                      // batang membulat di ujung data, rata di garis dasar
                      const top = Math.min(y0, y1);
                      return (
                        <path
                          key={`${s.name}-${i}`}
                          d={`M${x},${top + h} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + w - r},${top} Q${x + w},${top} ${x + w},${top + r} L${x + w},${top + h} Z`}
                          fill={s.color}
                          opacity={hover == null || hover === i ? 1 : 0.55}
                        />
                      );
                    }),
                  )
                : series.map((s) => {
                    let d = "";
                    let pen = false;
                    s.values.forEach((v, i) => {
                      if (v == null || !Number.isFinite(v)) {
                        pen = false;
                        return;
                      }
                      d += `${pen ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)} `;
                      pen = true;
                    });
                    return (
                      <g key={s.name}>
                        <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                        {n <= 60 &&
                          s.values.map((v, i) =>
                            v == null || !Number.isFinite(v) ? null : <circle key={i} cx={xOf(i)} cy={yOf(v)} r={hover === i ? 4 : 2.5} fill={s.color} className="stroke-white dark:stroke-slate-900" strokeWidth={1.5} />,
                          )}
                      </g>
                    );
                  })}
              {hover != null && spec.chart === "line" && <line x1={xOf(hover)} x2={xOf(hover)} y1={PAD_T} y2={PAD_T + plotH} className="stroke-slate-300 dark:stroke-slate-600" strokeDasharray="3 3" />}
              {spec.labels.map((l, i) =>
                i % every === 0 ? (
                  <text key={i} x={xOf(i)} y={H - 6} textAnchor="middle" className="fill-slate-400 text-[10px]">
                    {l}
                  </text>
                ) : null,
              )}
            </>
          )}
        </svg>
        {hover != null && scale && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-[120px] rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-md dark:border-slate-700 dark:bg-slate-900/95"
            style={{ left: `${Math.min(78, Math.max(2, (xOf(hover) / W) * 100 + 2))}%` }}
          >
            <p className="mb-0.5 font-medium text-slate-700 dark:text-slate-200">{spec.labels[hover]}</p>
            {series.map((s) => (
              <p key={s.name} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
                <span className="text-slate-400">{s.name}</span>
                <span className="ml-auto pl-2 tabular-nums">{fmtVal(s.values[hover], spec.unit)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      {spec.caption && <p className="mt-1 text-[11px] text-slate-400">{spec.caption}</p>}
    </div>
  );
}

const TONE: Record<NonNullable<StatItem["tone"]>, string> = {
  good: "border-l-emerald-500",
  bad: "border-l-red-500",
  warn: "border-l-amber-400",
  neutral: "border-l-indigo-500",
};

export function StatTiles({ items }: { items: StatItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map((it, i) => (
        <div key={i} className={`rounded-xl border border-l-4 border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900 ${TONE[it.tone ?? "neutral"]}`}>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{it.label}</p>
          <p className="truncate text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{it.value}</p>
          {it.sub && <p className="truncate text-[10px] text-slate-400">{it.sub}</p>}
        </div>
      ))}
    </div>
  );
}
