"use client";

import { useCallback, useEffect, useState } from "react";
import MetricChart from "@/components/MetricChart";

type DiskMount = { mount: string; sizeMb: number; usedMb: number; pct: number };
type ProcInfo = { pid: string; user: string; cpu: number; mem: number; comm: string };

type LiveSample = {
  hostname?: string;
  osName?: string;
  kernel?: string;
  cpu?: number;
  cpuCores?: number;
  memPct?: number;
  memUsedMb?: number;
  memTotalMb?: number;
  load1?: number;
  load5?: number;
  load15?: number;
  uptimeSec?: number;
  netInBps?: number;
  netOutBps?: number;
  disk: DiskMount[];
  topProcs: ProcInfo[];
  ports: string[];
  failedSvcs: string[];
};

type SampleSeries = {
  t: string;
  ok: boolean;
  cpu: number | null;
  memPct: number | null;
  netInBps: number | null;
  netOutBps: number | null;
};

export type SshLastSample = {
  at: string;
  ok: boolean;
  error: string | null;
  hostname?: string | null;
  osName?: string | null;
  kernel?: string | null;
  cpu?: number | null;
  cpuCores?: number | null;
  memPct?: number | null;
  memUsedMb?: number | null;
  memTotalMb?: number | null;
  load1?: number | null;
  load5?: number | null;
  load15?: number | null;
  uptimeSec?: number | null;
  netInBps?: number | null;
  netOutBps?: number | null;
  disk: DiskMount[];
  topProcs: ProcInfo[];
  ports: string[];
  failedSvcs: string[];
};

const PERIODS = [
  { v: "hour", l: "1 Jam" },
  { v: "day", l: "24 Jam" },
  { v: "week", l: "7 Hari" },
  { v: "month", l: "30 Hari" },
];

const AUTO_REFRESH_MS = 30 * 1000;

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800 dark:text-slate-100">{value ?? "—"}</p>
    </div>
  );
}

function humanizeUptime(sec?: number): string {
  if (sec === undefined || sec === null) return "—";
  if (sec < 60) return `${sec} dtk`;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d} hari`);
  if (h) parts.push(`${h} jam`);
  if (d === 0) parts.push(`${m} mnt`);
  return parts.join(" ");
}

function fmtMb(v?: number): string {
  if (v === undefined || v === null) return "—";
  if (v >= 1024) return `${(v / 1024).toFixed(1)} Gb`;
  return `${Math.round(v)} Mb`;
}

function fmtRate(v?: number): string {
  if (v === undefined || v === null) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} MB/s`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} KB/s`;
  return `${Math.round(v)} B/s`;
}

function DiskBar({ d }: { d: DiskMount }) {
  const pct = Math.min(d.pct, 100);
  const color = pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-medium text-slate-700 dark:text-slate-200">{d.mount}</span>
        <span className="shrink-0 tabular-nums text-slate-400 dark:text-slate-500">
          {fmtMb(d.usedMb)} / {fmtMb(d.sizeMb)} · {d.pct}%
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function SshMonitorPanel({
  sshId,
  name,
  host,
  username,
  port,
  initial,
  onClose,
}: {
  sshId: string;
  name: string;
  host: string;
  username: string;
  port: number;
  initial?: SshLastSample | null;
  onClose?: () => void;
}) {
  const [sample, setSample] = useState<LiveSample | null>(initial && initial.ok ? (initial as LiveSample) : null);
  const [lastCheck, setLastCheck] = useState<Date | null>(initial?.at ? new Date(initial.at) : null);
  const [lastOk, setLastOk] = useState<boolean | null>(initial?.ok ?? null);
  const [lastError, setLastError] = useState<string | null>(initial && !initial.ok ? initial.error : null);
  const [refreshing, setRefreshing] = useState(false);
  const [auto, setAuto] = useState(true);
  const [periode, setPeriode] = useState("hour");
  const [series, setSeries] = useState<SampleSeries[]>([]);
  const [uptimePct, setUptimePct] = useState<number | null>(null);
  const [metricsAt, setMetricsAt] = useState<Date | null>(null);

  const loadCharts = useCallback(
    async (p: string) => {
      try {
        const res = await fetch(`/api/db/ssh/${sshId}/metrics?periode=${p}`);
        const d = await res.json();
        if (d.ok) setSeries(d.data.samples as SampleSeries[]);
        setMetricsAt(new Date());
      } catch {
        /* keep old data */
      }
    },
    [sshId],
  );

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/db/ssh/${sshId}/refresh`, { method: "POST" });
      const d = await res.json();
      if (d.ok) {
        setSample(d.data as LiveSample);
        setLastOk(true);
        setLastError(null);
      } else {
        setLastOk(false);
        setLastError(d.message ?? "Gagal mengambil metrik");
      }
      setLastCheck(new Date());
    } catch {
      setLastOk(false);
      setLastError("Gagal terhubung ke server");
      setLastCheck(new Date());
    } finally {
      setRefreshing(false);
      loadCharts(periode);
    }
  }, [sshId, periode, loadCharts]);

  // Riwayat uptime 7 hari + data awal
  useEffect(() => {
    setUptimePct(null);
    fetch(`/api/db/ssh/${sshId}/history?hours=168`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && typeof d.data.uptimePct === "number") setUptimePct(d.data.uptimePct);
      })
      .catch(() => {});
  }, [sshId]);

  // Metrik per periode
  useEffect(() => {
    setSeries([]);
    loadCharts(periode);
  }, [periode, loadCharts]);

  // Auto-refresh live 30 detik (aktif selama panel terbuka)
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(doRefresh, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [auto, doRefresh]);

  const okSamples = (key: "cpu" | "memPct" | "netInBps" | "netOutBps") =>
    series.filter((s) => s.ok && s[key] !== null).map((s) => ({ t: s.t, v: s[key] as number }));

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 truncate text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            <span className="truncate">{name}</span>
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                lastOk === true ? "bg-emerald-500" : lastOk === false ? "bg-red-500" : "bg-slate-300 dark:bg-slate-600"
              }`}
              title={lastOk === true ? "Terhubung" : lastOk === false ? "Gagal" : "Belum ada data"}
            />
          </h2>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {username}@{host}:{port} · {sample?.hostname ? `hostname ${sample.hostname}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            <input type="checkbox" checked={auto} onChange={() => setAuto((a) => !a)} className="h-3 w-3 accent-indigo-600" />
            auto 30 dtk
          </label>
          <button
            onClick={doRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            <svg viewBox="0 0 16 16" className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} fill="currentColor">
              <path d="M8 3a5 5 0 1 0 4.546 2.914.75.75 0 0 1 1.364-.626A6.5 6.5 0 1 1 8 1.5v-1a.25.25 0 0 1 .41-.192l2.36 1.966a.25.25 0 0 1 0 .384L8.41 4.624A.25.25 0 0 1 8 4.432V3Z" />
            </svg>
            {refreshing ? "Mengambil…" : "Muat Ulang"}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title="Tutup panel"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 shadow-sm transition hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {lastError && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          ✕ {lastError}
          {lastCheck && (
            <span className="ml-2 text-xs opacity-70">
              · {lastCheck.toLocaleTimeString("id-ID")}
            </span>
          )}
        </p>
      )}

      {!sample ? (
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
            ))}
          </div>
          <p className="text-center text-sm text-slate-400 dark:text-slate-500">
            {lastCheck ? "Klik Muat Ulang untuk mencoba lagi." : "Tekan Muat Ulang untuk mengambil metrik pertama."}
          </p>
        </div>
      ) : (
        <div className="animate-fade-up">
          {/* Kartu info utama */}
          <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-3">
            <Info label="CPU" value={sample.cpu !== undefined ? <span className="tabular-nums">{sample.cpu}%</span> : undefined} />
            <Info
              label="Core"
              value={
                sample.cpuCores !== undefined
                  ? <span className="tabular-nums">{sample.cpuCores} core</span>
                  : undefined
              }
            />
            <Info
              label="Memori"
              value={
                sample.memUsedMb !== undefined && sample.memTotalMb !== undefined
                  ? `${fmtMb(sample.memUsedMb)} / ${fmtMb(sample.memTotalMb)} (${sample.memPct ?? "—"}%)`
                  : undefined
              }
            />
            <Info
              label="Load 1/5/15"
              value={
                sample.load1 !== undefined
                  ? `${sample.load1} / ${sample.load5 ?? "—"} / ${sample.load15 ?? "—"}`
                  : undefined
              }
            />
            <Info label="Uptime" value={humanizeUptime(sample.uptimeSec)} />
            <Info label="OS" value={sample.osName} />
            <Info label="Kernel" value={sample.kernel} />
            <Info label="Network masuk" value={<span className="tabular-nums">{fmtRate(sample.netInBps)}</span>} />
            <Info label="Network keluar" value={<span className="tabular-nums">{fmtRate(sample.netOutBps)}</span>} />
            <Info label="Hostname" value={sample.hostname} />
            <Info
              label="Uptime 7 hari"
              value={
                uptimePct === null ? (
                  "—"
                ) : (
                  <span className={uptimePct >= 99 ? "text-emerald-600 dark:text-emerald-400" : uptimePct >= 90 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}>
                    {uptimePct.toFixed(2)}%
                  </span>
                )
              }
            />
            <Info
              label="Cek terakhir"
              value={
                lastCheck ? (
                  <span className="tabular-nums">
                    {lastCheck.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                ) : (
                  "—"
                )
              }
            />
          </div>

          {/* Disk */}
          {sample.disk.length > 0 && (
            <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Disk</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {sample.disk.map((d) => (
                  <DiskBar key={d.mount} d={d} />
                ))}
              </div>
            </div>
          )}

          {/* Proses + port + service gagal */}
          <div className="mb-5 grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Proses teratas</h3>
              {sample.topProcs.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500">Tidak ada data.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-slate-400 dark:text-slate-500">
                        <th className="pb-2 pr-2 font-medium">PID</th>
                        <th className="pb-2 pr-2 font-medium">User</th>
                        <th className="pb-2 pr-2 text-right font-medium">CPU</th>
                        <th className="pb-2 pr-2 text-right font-medium">MEM</th>
                        <th className="pb-2 font-medium">Perintah</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {sample.topProcs.slice(0, 8).map((p) => (
                        <tr key={p.pid} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="py-1.5 pr-2 text-slate-500 dark:text-slate-400">{p.pid}</td>
                          <td className="py-1.5 pr-2 text-slate-500 dark:text-slate-400">{p.user}</td>
                          <td className="py-1.5 pr-2 text-right text-slate-700 dark:text-slate-200">{p.cpu.toFixed(1)}%</td>
                          <td className="py-1.5 pr-2 text-right text-slate-700 dark:text-slate-200">{p.mem.toFixed(1)}%</td>
                          <td className="truncate py-1.5 text-slate-600 dark:text-slate-300">{p.comm}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Port listening</h3>
              {sample.ports.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500">Tidak ada / tidak didukung.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {sample.ports.map((p) => (
                    <span key={p} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium tabular-nums text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">
                      :{p}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Layanan gagal</h3>
              {sample.failedSvcs.length === 0 ? (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ Tidak ada layanan yang gagal</p>
              ) : (
                <ul className="space-y-1.5">
                  {sample.failedSvcs.map((s) => (
                    <li key={s} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 ring-1 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900">
                      ✕ {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Periode grafik */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {PERIODS.map((p) => (
                <button
                  key={p.v}
                  onClick={() => setPeriode(p.v)}
                  className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
                    periode === p.v
                      ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  {p.l}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {metricsAt ? `metrics ${metricsAt.toLocaleTimeString("id-ID")}` : "memuat…"} · sampel /15 mnt
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <MetricChart
              title="CPU"
              subtitle="pemakaian prosesor (%)"
              yMax={100}
              format={(v) => `${v.toFixed(1)}%`}
              series={[
                { label: "CPU", color: "#6366f1", fill: "rgba(99,102,241,0.12)", points: okSamples("cpu") },
              ]}
            />
            <MetricChart
              title="Memori"
              subtitle="pemakaian RAM (%)"
              yMax={100}
              format={(v) => `${v.toFixed(1)}%`}
              series={[
                { label: "RAM", color: "#10b981", fill: "rgba(16,185,129,0.12)", points: okSamples("memPct") },
              ]}
            />
            <div className="sm:col-span-2">
              <MetricChart
                title="Network"
                subtitle="kecepatan transfer"
                format={fmtRate}
                series={[
                  { label: "Masuk", color: "#0ea5e9", fill: "rgba(14,165,233,0.10)", points: okSamples("netInBps") },
                  { label: "Keluar", color: "#f59e0b", points: okSamples("netOutBps") },
                ]}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
