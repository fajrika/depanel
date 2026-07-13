"use client";

import { useCallback, useEffect, useState } from "react";
import MetricChart from "@/components/MetricChart";
import ScheduleForm from "@/components/ScheduleForm";
import BackupPanel from "@/components/BackupPanel";
import FirewallPanel from "@/components/FirewallPanel";
import ManagePanel from "@/components/ManagePanel";
import ConsolePanel from "@/components/ConsolePanel";

type Rrd = {
  cpu?: { time: string; cpu: number }[];
  memory?: { time: string; raw_max_memory: number; raw_usage_memory: number }[];
  network?: { time: string; raw_netin: number; raw_netout: number }[];
  disk?: { time: string; raw_diskwrite: number; raw_diskread: number }[];
};

type Detail = Record<string, unknown> & {
  hostname?: string;
  status?: string;
  os_name?: string;
  cpu?: string;
  is_cpu_dedicated?: boolean;
  memory?: string;
  storage?: string;
  location?: string;
  tier?: string;
  price_per_hour?: number;
  estimated_monthly_price?: number;
  cost?: number;
  last_started_at?: string;
  last_backup_at?: string;
  public_ip?: { ip_address?: string };
};

export type PanelTab = "monitoring" | "jadwal" | "backup" | "firewall" | "kelola" | "console";

const PERIODS = [
  { v: "hour", l: "1 Jam" },
  { v: "day", l: "24 Jam" },
  { v: "week", l: "7 Hari" },
  { v: "month", l: "30 Hari" },
  { v: "year", l: "1 Tahun" },
];

const METRICS_REFRESH_MS = 2 * 60 * 1000; // hemat rate-limit depa (60 req/menit)

function rupiah(n?: number): string {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
}

function fmtMb(v: number): string {
  if (v >= 1024) return `${(v / 1024).toFixed(2)} Gb`;
  if (v >= 1) return `${v.toFixed(2)} Mb`;
  return `${Math.round(v * 1000)} Kb`;
}

/** Buang sampel RRD terakhir (bucket menit berjalan, selalu 0). */
function trim<T>(arr: T[] | undefined): T[] {
  if (!arr || arr.length < 3) return arr ?? [];
  return arr.slice(0, -1);
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800 dark:text-slate-100">{value ?? "—"}</p>
    </div>
  );
}

export default function ServerMonitor({
  serverId,
  managed = false,
  onClose,
  initialTab = "monitoring",
  canSchedule = true,
  canBackup = true,
  isStaff = false,
  onScheduleSaved,
}: {
  serverId: string;
  managed?: boolean;
  onClose?: () => void;
  initialTab?: PanelTab;
  canSchedule?: boolean;
  canBackup?: boolean;
  isStaff?: boolean;
  onScheduleSaved?: () => void;
}) {
  const [tab, setTab] = useState<PanelTab>(initialTab);
  const [uptime, setUptime] = useState<number | null>(null);
  const [periode, setPeriode] = useState("hour");
  const [rrd, setRrd] = useState<Rrd | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [serverName, setServerName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [metricsAt, setMetricsAt] = useState<Date | null>(null);

  useEffect(() => setTab(initialTab), [initialTab, serverId]);

  // F4: uptime 7 hari dari sampel metrik milik Depanel sendiri.
  useEffect(() => {
    setUptime(null);
    fetch(`/api/servers/${serverId}/history?hours=168`)
      .then((r) => r.json())
      .then((d) => { if (d.ok && typeof d.data.uptimePct === "number") setUptime(d.data.uptimePct); })
      .catch(() => {});
  }, [serverId]);

  // Detail: sekali per server (cache 10 menit di sisi server juga).
  useEffect(() => {
    setDetail(null);
    setServerName("");
    fetch(`/api/servers/${serverId}/detail`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setDetail(d.data.detail as Detail);
          setServerName(d.data.server.hostname);
        } else {
          setError(d.message ?? "Gagal memuat detail");
        }
      })
      .catch(() => setError("Gagal terhubung ke server"));
  }, [serverId]);

  // Metrics: per periode, auto-refresh tiap 2 menit (tanpa menyentuh detail).
  const loadMetrics = useCallback(
    async (p: string) => {
      try {
        const res = await fetch(`/api/servers/${serverId}/metrics?periode=${p}`);
        const m = await res.json();
        if (m.ok) {
          setRrd(m.data as Rrd);
          setError(null);
        } else {
          setError(m.message ?? "Gagal memuat metrics");
        }
        setMetricsAt(new Date());
      } catch {
        setError("Gagal terhubung ke server");
      }
    },
    [serverId],
  );

  useEffect(() => {
    setRrd(null);
    loadMetrics(periode);
    const t = setInterval(() => loadMetrics(periode), METRICS_REFRESH_MS);
    return () => clearInterval(t);
  }, [periode, loadMetrics]);

  const tabs: { v: PanelTab; l: string }[] = [
    { v: "monitoring", l: "📊 Monitoring" },
    ...(canSchedule ? [{ v: "jadwal" as PanelTab, l: "🕒 Jadwal" }] : []),
    ...(canBackup ? [{ v: "backup" as PanelTab, l: "💾 Backup" }] : []),
    ...(isStaff ? [{ v: "firewall" as PanelTab, l: "🛡️ Firewall" }] : []),
    ...(isStaff ? [{ v: "console" as PanelTab, l: "🖥️ Console" }] : []),
    ...(isStaff ? [{ v: "kelola" as PanelTab, l: "⚙️ Kelola" }] : []),
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 truncate text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            <span className="truncate">{serverName || "…"}</span>
            {detail?.status && (
              <span
                className={`shrink-0 text-xs font-medium ${
                  String(detail.status).toLowerCase() === "running"
                    ? "text-emerald-600"
                    : "text-slate-400 dark:text-slate-500"
                }`}
              >
                ● {String(detail.status)}
              </span>
            )}
          </h2>
        </div>
        <div className="flex max-w-full items-center gap-2">
          <div className="flex max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((t) => (
              <button
                key={t.v}
                onClick={() => setTab(t.v)}
                className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                  tab === t.v
                    ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {t.l}
              </button>
            ))}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              title="Tutup panel"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 shadow-sm transition hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}

      {/* ===== TAB: MONITORING ===== */}
      {tab === "monitoring" && (
        <div className="animate-fade-up">
          {/* Info server — dari cache, tidak ikut periode */}
          {detail ? (
            <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-3">
              <Info label="OS" value={detail.os_name} />
              <Info label="CPU" value={detail.cpu ? `${detail.cpu}${detail.is_cpu_dedicated ? " (dedicated)" : ""}` : undefined} />
              <Info label="Memori" value={detail.memory} />
              <Info label="Storage" value={detail.storage} />
              <Info label="Lokasi" value={detail.location} />
              <Info label="IP Publik" value={detail.public_ip?.ip_address} />
              <Info label="Tier" value={detail.tier} />
              <Info label="Biaya / jam" value={rupiah(detail.price_per_hour)} />
              <Info label="Estimasi / bulan" value={rupiah(detail.estimated_monthly_price)} />
              <Info label="Biaya berjalan" value={<span className="text-amber-600 dark:text-amber-400">{rupiah(detail.cost)}</span>} />
              <Info label="Terakhir dinyalakan" value={detail.last_started_at} />
              <Info label="Backup terakhir" value={detail.last_backup_at} />
              <Info
                label="Uptime 7 hari"
                value={
                  uptime === null ? (
                    "—"
                  ) : (
                    <span className={uptime >= 99 ? "text-emerald-600 dark:text-emerald-400" : uptime >= 90 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}>
                      {uptime.toFixed(2)}%
                    </span>
                  )
                }
              />
              <Info label="Sumber uptime" value={<span className="text-xs text-slate-400">sampel Depanel /15 mnt</span>} />
            </div>
          ) : (
            <div className="mb-5 h-32 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          )}

          {/* Periode + status refresh */}
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
              {metricsAt ? `metrics ${metricsAt.toLocaleTimeString("id-ID")}` : "memuat…"} · refresh tiap 2 mnt
            </span>
          </div>

          {rrd === null ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="animate-fade-up" style={{ animationDelay: "0ms" }}>
                <MetricChart
                  title="CPU"
                  subtitle="pemakaian prosesor (%)"
                  yMax={100}
                  format={(v) => `${v.toFixed(1)}%`}
                  series={[
                    { label: "CPU", color: "#6366f1", fill: "rgba(99,102,241,0.12)", points: trim(rrd.cpu).map((p) => ({ t: p.time, v: p.cpu })) },
                  ]}
                />
              </div>
              <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
                <MetricChart
                  title="Memori"
                  subtitle="pemakaian RAM (GB)"
                  yMax={rrd.memory?.length ? Math.max(...rrd.memory.map((p) => p.raw_max_memory)) : undefined}
                  format={(v) => `${v.toFixed(2)} GB`}
                  series={[
                    { label: "Terpakai", color: "#10b981", fill: "rgba(16,185,129,0.12)", points: trim(rrd.memory).map((p) => ({ t: p.time, v: p.raw_usage_memory })) },
                  ]}
                />
              </div>
              <div className="animate-fade-up" style={{ animationDelay: "160ms" }}>
                <MetricChart
                  title="Network"
                  subtitle="lalu lintas jaringan"
                  format={fmtMb}
                  series={[
                    { label: "Masuk", color: "#0ea5e9", fill: "rgba(14,165,233,0.10)", points: trim(rrd.network).map((p) => ({ t: p.time, v: p.raw_netin })) },
                    { label: "Keluar", color: "#f59e0b", points: trim(rrd.network).map((p) => ({ t: p.time, v: p.raw_netout })) },
                  ]}
                />
              </div>
              <div className="animate-fade-up" style={{ animationDelay: "240ms" }}>
                <MetricChart
                  title="Disk I/O"
                  subtitle="baca / tulis disk"
                  format={fmtMb}
                  series={[
                    { label: "Tulis", color: "#8b5cf6", fill: "rgba(139,92,246,0.10)", points: trim(rrd.disk).map((p) => ({ t: p.time, v: p.raw_diskwrite })) },
                    { label: "Baca", color: "#ec4899", points: trim(rrd.disk).map((p) => ({ t: p.time, v: p.raw_diskread })) },
                  ]}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== TAB: JADWAL ===== */}
      {tab === "jadwal" && canSchedule && <ScheduleForm serverId={serverId} managed={managed} onSaved={onScheduleSaved} />}

      {/* ===== TAB: BACKUP ===== */}
      {tab === "backup" && canBackup && <BackupPanel serverId={serverId} hostname={serverName} />}

      {/* ===== TAB: FIREWALL (F7) ===== */}
      {tab === "firewall" && isStaff && <FirewallPanel serverId={serverId} isStaff={isStaff} />}

      {/* ===== TAB: CONSOLE (F8) ===== */}
      {tab === "console" && isStaff && <ConsolePanel serverId={serverId} hostname={serverName} />}

      {/* ===== TAB: KELOLA — resize/tier/reinstall/hapus (F9/F10/F11) ===== */}
      {tab === "kelola" && isStaff && <ManagePanel serverId={serverId} hostname={serverName} onChanged={onScheduleSaved} />}
    </div>
  );
}
