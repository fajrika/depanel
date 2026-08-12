"use client";

import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Hc = {
  id: string;
  name: string;
  url: string;
  method: string;
  expectedStatus: number;
  intervalMin: number;
  timeoutSec: number;
  enabled: boolean;
  lastStatus: string | null;
  lastLatencyMs: number | null;
  lastCheckAt: string | null;
  lastUpAt: string | null;
  uptimePct: number | null;
};

type Sample = {
  t: string;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
};

type HcStats = {
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  last24: { label: string; pct: number | null; ok: boolean | null }[];
  days30: { label: string; pct: number | null; ok: boolean | null }[];
  rangeStart: string;
  rangeEnd: string;
  samples24: { t: string; ok: boolean; latencyMs: number | null }[];
  samples30: { t: string; ok: boolean; latencyMs: number | null }[];
  offset: number;
};

const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const label = "block text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btnPrimary = "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

function fmtTime(s?: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

function fmtUptime(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(2)}%`;
}

function fmtInterval(m: number): string {
  if (m < 60) return `${m} mnt`;
  if (m % 60 === 0) return `${m / 60} jam`;
  return `${Math.floor(m / 60)}j ${m % 60}m`;
}

/** Strip kotak uptime ala Uptime Kuma. */
function UptimePills({ buckets }: { buckets: { label: string; pct: number | null; ok: boolean | null }[] }) {
  const color = (b: { pct: number | null; ok: boolean | null }) => {
    if (b.pct === null) return "bg-slate-200 dark:bg-slate-700";
    if (b.pct >= 100) return "bg-emerald-500";
    if (b.pct <= 0) return "bg-red-500";
    return "bg-amber-400";
  };
  return (
    <div className="flex flex-wrap gap-[3px]">
      {buckets.map((b, i) => (
        <span key={i} title={`${b.label}: ${b.pct === null ? "—" : `${b.pct}%`}`} className={`h-3 w-[7px] rounded-[2px] ${color(b)}`} />
      ))}
    </div>
  );
}

/** Grid pill per pengetesan (mode expand) — hover menunjukkan waktu persis. */
function SamplePills({ samples }: { samples: { t: string; ok: boolean; latencyMs: number | null }[] }) {
  return (
    <div className="flex max-h-40 flex-wrap gap-[2px] overflow-y-auto">
      {samples.map((s, i) => (
        <span
          key={i}
          title={`${new Date(s.t).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "medium" })} · ${s.ok ? "up" : "down"}${s.latencyMs !== null ? ` · ${s.latencyMs}ms` : ""}`}
          className={`h-[7px] w-[7px] rounded-[1px] ${s.ok ? "bg-emerald-500" : "bg-red-500"}`}
        />
      ))}
    </div>
  );
}

/** Daftar sampel mentah (mode expand 30 hari) — scrollable, terbaru di atas. */
function SampleList({ samples }: { samples: { t: string; ok: boolean; latencyMs: number | null }[] }) {
  return (
    <div className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
      {samples.map((s, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-1.5 text-xs">
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${s.ok ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900"}`}>
            {s.ok ? "up" : "down"}
          </span>
          <span className="tabular-nums text-slate-500 dark:text-slate-400">{new Date(s.t).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "medium" })}</span>
          <span className="tabular-nums text-slate-400">{s.latencyMs !== null ? `${s.latencyMs}ms` : "—"}</span>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const up = status === "up";
  const down = status === "down";
  const cls = up
    ? "bg-emerald-500 text-white ring-emerald-600"
    : down
      ? "bg-red-500 text-white ring-red-600"
      : "bg-slate-200 text-slate-500 ring-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600";
  return (
    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl shadow-sm ring-1 ${cls}`}>
      {up ? "✓" : down ? "✕" : "·"}
    </span>
  );
}

/** Panel detail (dipakai di list-view kanan dan modal grid-view). */
function HealthDetail({
  c,
  stats,
  samples,
  expandedPills,
  onLoadSamples,
  onToggleExpand,
  onOffset,
  onClose,
}: {
  c: Hc;
  stats?: HcStats;
  samples: Sample[] | null;
  expandedPills: { h24?: boolean; d30?: boolean };
  onLoadSamples: (id: string) => void;
  onToggleExpand: (id: string, which: "h24" | "d30") => void;
  onOffset: (id: string, offset: number) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const up = c.lastStatus === "up";
  useEffect(() => {
    if (samples === null) onLoadSamples(c.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, samples === null]);

  return (
    <div className="animate-slide-in-right space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <StatusBadge status={c.lastStatus} />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">{c.name}</h2>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{c.method} {c.url}</p>
            <p className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-400">
              <span>{t("hc.intervalLabel").replace("{n}", String(c.intervalMin))}</span>
              <span>·</span>
              <span>{t("hc.expStatus").replace("{n}", String(c.expectedStatus))}</span>
              <span>·</span>
              <span>{t("hc.timeout")}: {c.timeoutSec}s</span>
            </p>
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
          {t("hc.close")}
        </button>
      </div>

      <div className={`${card} p-5`}>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{t("hc.up24h")}</p>
            <p className={`mt-0.5 font-semibold tabular-nums ${(stats?.uptime24h ?? 0) >= 99 ? "text-emerald-600" : (stats?.uptime24h ?? 0) < 90 ? "text-red-600" : "text-slate-800 dark:text-slate-100"}`}>{fmtUptime(stats?.uptime24h ?? null)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{t("hc.up7d")}</p>
            <p className="mt-0.5 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{fmtUptime(stats?.uptime7d ?? null)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{t("hc.up30d")}</p>
            <p className="mt-0.5 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{fmtUptime(stats?.uptime30d ?? null)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{t("hc.latency")}</p>
            <p className="mt-0.5 font-semibold tabular-nums text-slate-800 dark:text-slate-100">{c.lastLatencyMs !== null ? `${c.lastLatencyMs}ms` : "—"}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{t("hc.lastCheck")}</p>
            <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{fmtTime(c.lastCheckAt)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{t("hc.lastUp")}</p>
            <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{fmtTime(c.lastUpAt)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{t("hc.interval")}</p>
            <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{fmtInterval(c.intervalMin)}</p>
          </div>
        </div>

        {stats && (
          <div className="mt-5 space-y-3">
            {/* 24 jam */}
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("hc.last24h")}</p>
                <button onClick={() => onToggleExpand(c.id, "h24")} className="text-[10px] font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  {expandedPills.h24 ? t("hc.collapse") : t("hc.expand")}
                </button>
              </div>
              {expandedPills.h24 ? (
                <SamplePills samples={stats.samples24} />
              ) : (
                <UptimePills buckets={stats.last24} />
              )}
            </div>

            {/* 30 hari — bisa digeser ke periode sebelumnya */}
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("hc.last30d")}</p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] tabular-nums text-slate-400">
                    {new Date(stats.rangeStart).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })} – {new Date(stats.rangeEnd).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                  <button onClick={() => onOffset(c.id, (stats.offset || 0) + 30)} disabled={stats.offset >= 90} title={t("hc.prevPeriod")} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 transition hover:bg-slate-50 disabled:opacity-30 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">◀</button>
                  <button onClick={() => onOffset(c.id, Math.max(0, (stats.offset || 0) - 30))} disabled={!stats.offset} title={t("hc.nextPeriod")} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 transition hover:bg-slate-50 disabled:opacity-30 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">▶</button>
                  <button onClick={() => onToggleExpand(c.id, "d30")} className="text-[10px] font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    {expandedPills.d30 ? t("hc.collapse") : t("hc.expand")}
                  </button>
                </div>
              </div>
              {expandedPills.d30 ? (
                <SampleList samples={stats.samples30} />
              ) : (
                <UptimePills buckets={stats.days30} />
              )}
            </div>
          </div>
        )}
      </div>

      <div className={`${card} p-5`}>
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{t("hc.history")}</h3>
        {samples === null ? (
          <p className="text-xs text-slate-400">…</p>
        ) : samples.length === 0 ? (
          <p className="text-xs text-slate-400">{t("hc.noSamples")}</p>
        ) : (
          <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {[...samples].reverse().map((s, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3 py-2 text-xs">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${s.ok ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900"}`}>
                  {s.ok ? t("hc.up") : t("hc.down")}
                </span>
                <span className="text-slate-500 dark:text-slate-400">{fmtTime(s.t)}</span>
                <span className="tabular-nums text-slate-500 dark:text-slate-400">{s.statusCode ?? "—"}</span>
                <span className="tabular-nums text-slate-500 dark:text-slate-400">{s.latencyMs !== null ? `${s.latencyMs}ms` : "—"}</span>
                <span className="min-w-0 flex-1 truncate text-slate-400">{s.error ?? ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function HealthChecksPage() {
  const { t } = useLang();
  const [checks, setChecks] = useState<Hc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "grid">("grid");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalId, setModalId] = useState<string | null>(null);
  const [samples, setSamples] = useState<Record<string, Sample[] | null>>({});
  const [stats, setStats] = useState<Record<string, HcStats>>({});
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [expandedPills, setExpandedPills] = useState<Record<string, { h24?: boolean; d30?: boolean }>>({});
  const [checking, setChecking] = useState<string | null>(null);

  const [fName, setFName] = useState("");
  const [fUrl, setFUrl] = useState("");
  const [fMethod, setFMethod] = useState("GET");
  const [fStatus, setFStatus] = useState("200");
  const [fInterval, setFInterval] = useState("1");
  const [fTimeout, setFTimeout] = useState("10");

  const loadStats = useCallback(async (id: string, offset: number) => {
    const sRes = await fetch(`/api/healthchecks/${id}/stats?offset=${offset}`);
    const d = await sRes.json();
    if (d.ok) setStats((prev) => ({ ...prev, [id]: d.data }));
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/healthchecks");
      if (res.ok) {
        const list = (await res.json()).data ?? [];
        setChecks(list);
        await Promise.all(
          list.map(async (c: Hc) => {
            await loadStats(c.id, 0);
          }),
        );
      }
    } catch {
      /* biarkan data lama */
    } finally {
      setLoading(false);
    }
  }, [loadStats]);

  useEffect(() => { load(); }, [load]);

  function onToggleExpand(id: string, which: "h24" | "d30") {
    setExpandedPills((prev) => ({ ...prev, [id]: { ...prev[id], [which]: !prev[id]?.[which] } }));
  }

  function onOffset(id: string, offset: number) {
    setOffsets((prev) => ({ ...prev, [id]: offset }));
    void loadStats(id, offset);
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem("depanel_hc_view");
      if (saved === "list" || saved === "grid") setView(saved);
    } catch {
      /* ignore */
    }
  }, []);

  function setViewAndSave(v: "list" | "grid") {
    setView(v);
    try {
      localStorage.setItem("depanel_hc_view", v);
    } catch {
      /* ignore */
    }
  }

  async function loadSamples(id: string) {
    if (samples[id] !== undefined) return;
    const res = await fetch(`/api/healthchecks/${id}/samples?hours=24`);
    const d = await res.json();
    setSamples((s) => ({ ...s, [id]: d.ok ? (d.data.samples ?? []) : [] }));
  }

  function resetForm() {
    setFName("");
    setFUrl("");
    setFMethod("GET");
    setFStatus("200");
    setFInterval("1");
    setFTimeout("10");
  }

  function startEdit(c: Hc) {
    setEditId(c.id);
    setFName(c.name);
    setFUrl(c.url);
    setFMethod(c.method);
    setFStatus(String(c.expectedStatus));
    setFInterval(String(c.intervalMin));
    setFTimeout(String(c.timeoutSec));
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payload = {
      name: fName,
      url: fUrl,
      method: fMethod,
      expectedStatus: Number(fStatus) || 200,
      intervalMin: Number(fInterval) || 1,
      timeoutSec: Number(fTimeout) || 10,
    };
    const res = await fetch(editId ? `/api/healthchecks/${editId}` : "/api/healthchecks", {
      method: editId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok || !d.ok) {
      setMsg({ text: d.message ?? t("hc.savedErr"), ok: false });
      return;
    }
    setMsg({ text: editId ? t("hc.updated") : t("hc.created"), ok: true });
    setEditId(null);
    setShowForm(false);
    resetForm();
    load();
  }

  async function checkNow(c: Hc) {
    setChecking(c.id);
    const res = await fetch(`/api/healthchecks/${c.id}/check`, { method: "POST" });
    const d = await res.json();
    setChecking(null);
    setMsg({ text: d.ok && d.data?.ok ? t("hc.checkedOk") : t("hc.checkedFail"), ok: d.ok && d.data?.ok });
    load();
  }

  async function toggleEnabled(c: Hc) {
    await fetch(`/api/healthchecks/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !c.enabled }),
    });
    load();
  }

  async function remove(c: Hc) {
    if (!confirm(`${t("hc.deleteConfirm")} "${c.name}" ${t("hc.deleteConfirm2")}`)) return;
    await fetch(`/api/healthchecks/${c.id}`, { method: "DELETE" });
    if (selectedId === c.id) setSelectedId(null);
    if (modalId === c.id) setModalId(null);
    load();
  }

  const selected = checks.find((c) => c.id === selectedId) ?? null;
  const modalCheck = checks.find((c) => c.id === modalId) ?? null;

  const actions = (c: Hc) => (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => toggleEnabled(c)} disabled={busy} className={`rounded-full px-2.5 py-1 font-medium ring-1 transition ${c.enabled ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"}`}>
        {c.enabled ? `✓ ${t("hc.enabled")}` : t("hc.disabled")}
      </button>
      <button onClick={() => checkNow(c)} disabled={busy || checking === c.id} className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300">
        {checking === c.id ? t("hc.checking") : t("hc.checkNow")}
      </button>
      <button onClick={() => startEdit(c)} disabled={busy} className="rounded-lg px-2 py-1.5 font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">{t("hc.edit")}</button>
      <button onClick={() => remove(c)} disabled={busy} className="rounded-lg px-2 py-1.5 font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950">{t("hc.delete")}</button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">🩺 {t("hc.title")}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("hc.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <button onClick={() => setViewAndSave("list")} title={t("hc.viewList")} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${view === "list" ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"}`}>
              ☰ {t("hc.viewList")}
            </button>
            <button onClick={() => setViewAndSave("grid")} title={t("hc.viewGrid")} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${view === "grid" ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"}`}>
              ▦ {t("hc.viewGrid")}
            </button>
          </div>
          <button onClick={() => { setShowForm(!showForm); setEditId(null); if (!showForm) resetForm(); }} className={btnPrimary}>
            {showForm ? t("hc.close") : t("hc.add")}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300" : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"}`}>
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className={`${card} animate-fade-up space-y-5 p-5`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editId ? t("hc.editTitle") : t("hc.createTitle")}</h2>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">✕</button>
          </div>

          <div className="flex flex-wrap gap-4">
            <div><label className={label}>{t("hc.name")}</label><input required value={fName} onChange={(e) => setFName(e.target.value)} placeholder={t("hc.namePh")} className={`${input} mt-1 w-52`} /></div>
            <div className="flex-1"><label className={label}>{t("hc.url")}</label><input required type="url" value={fUrl} onChange={(e) => setFUrl(e.target.value)} placeholder={t("hc.urlPh")} className={`${input} mt-1 w-full max-w-md font-mono`} /></div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div><label className={label}>{t("hc.method")}</label><select value={fMethod} onChange={(e) => setFMethod(e.target.value)} className={`${input} mt-1`}><option>GET</option><option>HEAD</option><option>POST</option></select></div>
            <div><label className={label}>{t("hc.expectedStatus")}</label><input type="number" min="100" max="599" value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${input} mt-1 w-20`} /></div>
            <div><label className={label}>{t("hc.interval")}</label><input type="number" min="1" max="1440" value={fInterval} onChange={(e) => setFInterval(e.target.value)} className={`${input} mt-1 w-20`} /></div>
            <div><label className={label}>{t("hc.timeout")}</label><input type="number" min="1" max="120" value={fTimeout} onChange={(e) => setFTimeout(e.target.value)} className={`${input} mt-1 w-20`} /></div>
          </div>

          <div className="flex justify-end">
            <button disabled={busy} className={btnPrimary}>{busy ? t("hc.saving") : t("hc.save")}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
      ) : checks.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
          {t("hc.empty")}
        </p>
      ) : view === "list" ? (
        /* ===== LIST VIEW: daftar kiri + detail kanan ===== */
        <div className="flex flex-col items-start gap-6 lg:flex-row">
          <div className="w-full shrink-0 space-y-3 lg:w-[380px]">
            {checks.map((c) => {
              const active = selectedId === c.id;
              const up = c.lastStatus === "up";
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(active ? null : c.id)}
                  className={`block w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition dark:bg-slate-900 ${
                    active
                      ? "border-indigo-400 ring-2 ring-indigo-300 dark:border-indigo-500 dark:ring-indigo-700"
                      : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-600"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${up ? "bg-emerald-500" : c.lastStatus === "down" ? "bg-red-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{c.name}</p>
                      <p className="truncate text-xs text-slate-400">{c.url}</p>
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                      {c.lastLatencyMs !== null ? `${c.lastLatencyMs}ms` : "—"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400">
                      {t("hc.up24h")}: <b className={up ? "text-emerald-600" : "text-red-600"}>{fmtUptime(stats[c.id]?.uptime24h ?? null)}</b>
                    </span>
                    {stats[c.id] && <UptimePills buckets={stats[c.id].last24.slice(0, 24)} />}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
                    {actions(c)}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="w-full min-w-0 flex-1">
            {selected ? (
              <HealthDetail
                c={selected}
                stats={stats[selected.id]}
                samples={samples[selected.id] ?? null}
                expandedPills={expandedPills[selected.id] ?? {}}
                onLoadSamples={loadSamples}
                onToggleExpand={onToggleExpand}
                onOffset={onOffset}
                onClose={() => setSelectedId(null)}
              />
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-10 text-center dark:border-slate-700 dark:bg-slate-900/40">
                <p className="text-4xl">🩺</p>
                <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">{t("hc.pickOne")}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ===== GRID VIEW: kartu, klik → modal ===== */
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {checks.map((c) => {
            const up = c.lastStatus === "up";
            const st = stats[c.id];
            return (
              <div key={c.id} onClick={() => setModalId(c.id)} className={`${card} cursor-pointer overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md`}>
                <div className="flex items-center gap-3 p-4 pb-2">
                  <StatusBadge status={c.lastStatus} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{c.name}</p>
                    <p className="truncate text-xs text-slate-400">{c.method} {c.url}</p>
                  </div>
                  {c.lastLatencyMs !== null && (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">{c.lastLatencyMs}ms</span>
                  )}
                </div>
                <div className="px-4 pb-2">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    <b className={up ? "text-emerald-600" : "text-red-600"}>{fmtUptime(st?.uptime24h ?? null)}</b> · {t("hc.up24h")} · {t("hc.up7d")} <b className="text-slate-700 dark:text-slate-200">{fmtUptime(st?.uptime7d ?? null)}</b> · {t("hc.up30d")} <b className="text-slate-700 dark:text-slate-200">{fmtUptime(st?.uptime30d ?? null)}</b>
                  </p>
                </div>
                {st && (
                  <div className="px-4 pb-3">
                    <UptimePills buckets={st.last24.slice(0, 24)} />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
                  {actions(c)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ===== MODAL detail (grid view) ===== */}
      {modalCheck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalId(null)}>
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-xl dark:border-slate-700 dark:bg-slate-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("hc.detail")}</p>
              <button onClick={() => setModalId(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
                {t("hc.close")}
              </button>
            </div>
            <HealthDetail
              c={modalCheck}
              stats={stats[modalCheck.id]}
              samples={samples[modalCheck.id] ?? null}
              expandedPills={expandedPills[modalCheck.id] ?? {}}
              onLoadSamples={loadSamples}
              onToggleExpand={onToggleExpand}
              onOffset={onOffset}
              onClose={() => setModalId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
