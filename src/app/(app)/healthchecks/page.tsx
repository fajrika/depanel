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

const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const label = "block text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btnPrimary = "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

function fmtTime(s?: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

type HcStats = {
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  hours24: { label: string; pct: number | null; ok: boolean | null }[];
  days30: { label: string; pct: number | null; ok: boolean | null }[];
};

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
        <span
          key={i}
          title={`${b.label}: ${b.pct === null ? "—" : `${b.pct}%`}`}
          className={`h-3 w-[7px] rounded-[2px] ${color(b)}`}
        />
      ))}
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [samples, setSamples] = useState<Record<string, Sample[]>>({});
  const [stats, setStats] = useState<Record<string, HcStats>>({});
  const [checking, setChecking] = useState<string | null>(null);

  const [fName, setFName] = useState("");
  const [fUrl, setFUrl] = useState("");
  const [fMethod, setFMethod] = useState("GET");
  const [fStatus, setFStatus] = useState("200");
  const [fInterval, setFInterval] = useState("1");
  const [fTimeout, setFTimeout] = useState("10");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/healthchecks");
      if (res.ok) {
        const list = (await res.json()).data ?? [];
        setChecks(list);
        // ambil statistik pill per health check (paralel)
        await Promise.all(
          list.map(async (c: Hc) => {
            const sRes = await fetch(`/api/healthchecks/${c.id}/stats`);
            const d = await sRes.json();
            if (d.ok) setStats((prev) => ({ ...prev, [c.id]: d.data }));
          }),
        );
      }
    } catch {
      /* biarkan data lama */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
    load();
  }

  async function toggleHistory(c: Hc) {
    if (expanded === c.id) {
      setExpanded(null);
      return;
    }
    setExpanded(c.id);
    if (!samples[c.id]) {
      const res = await fetch(`/api/healthchecks/${c.id}/samples?hours=24`);
      const d = await res.json();
      if (d.ok) setSamples((s) => ({ ...s, [c.id]: d.data.samples ?? [] }));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">🩺 {t("hc.title")}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("hc.subtitle")}</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditId(null); if (!showForm) resetForm(); }} className={btnPrimary}>
          {showForm ? t("hc.close") : t("hc.add")}
        </button>
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
      ) : (
        <div className="space-y-3">
          {checks.map((c) => {
            const up = c.lastStatus === "up";
            const st = stats[c.id];
            const fmtUptime = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);
            return (
              <div key={c.id} className={`${card} overflow-hidden`}>
                <div className="flex flex-wrap items-center gap-4 p-4">
                  {/* badge besar ala Uptime Kuma */}
                  <span
                    className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl shadow-sm ring-1 ${
                      up ? "bg-emerald-500 text-white ring-emerald-600" : c.lastStatus === "down" ? "bg-red-500 text-white ring-red-600" : "bg-slate-200 text-slate-500 ring-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600"
                    }`}
                  >
                    {up ? "✓" : c.lastStatus === "down" ? "✕" : "·"}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{c.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${up ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : c.lastStatus === "down" ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900" : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"}`}>
                        {c.lastStatus === "up" ? t("hc.up") : c.lastStatus === "down" ? t("hc.down") : t("hc.never")}
                      </span>
                      {c.lastLatencyMs !== null && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">{c.lastLatencyMs}ms</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-400">{c.method} {c.url}</p>

                    {/* statistik uptime */}
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <span><b className="text-slate-700 dark:text-slate-200">{fmtUptime(st?.uptime24h ?? null)}</b> · {t("hc.up24h")}</span>
                      <span><b className="text-slate-700 dark:text-slate-200">{fmtUptime(st?.uptime7d ?? null)}</b> · {t("hc.up7d")}</span>
                      <span><b className="text-slate-700 dark:text-slate-200">{fmtUptime(st?.uptime30d ?? null)}</b> · {t("hc.up30d")}</span>
                      <span className="text-slate-400 dark:text-slate-500">{t("hc.lastCheck")}: {fmtTime(c.lastCheckAt)}</span>
                    </div>

                    {/* pill strip ala Uptime Kuma */}
                    {st && (
                      <div className="mt-3 space-y-1.5">
                        <div>
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("hc.last24h")}</p>
                          <UptimePills buckets={st.hours24} />
                        </div>
                        <div>
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("hc.last30d")}</p>
                          <UptimePills buckets={st.days30} />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                    <button onClick={() => toggleEnabled(c)} disabled={busy} className={`rounded-full px-2.5 py-1 font-medium ring-1 transition ${c.enabled ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"}`}>
                      {c.enabled ? `✓ ${t("hc.enabled")}` : t("hc.disabled")}
                    </button>
                    <button onClick={() => checkNow(c)} disabled={busy || checking === c.id} className="rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300">
                      {checking === c.id ? t("hc.checking") : t("hc.checkNow")}
                    </button>
                    <button onClick={() => startEdit(c)} disabled={busy} className="rounded-lg px-2.5 py-1.5 font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">{t("hc.edit")}</button>
                    <button onClick={() => remove(c)} disabled={busy} className="rounded-lg px-2.5 py-1.5 font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950">{t("hc.delete")}</button>
                    <button onClick={() => toggleHistory(c)} className="rounded-lg px-2.5 py-1.5 font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
                      {expanded === c.id ? t("hc.hideHistory") : t("hc.history")}
                    </button>
                  </div>
                </div>

                {expanded === c.id && (
                  <div className="border-t border-slate-100 dark:border-slate-800">
                    {!samples[c.id] ? (
                      <p className="px-4 py-3 text-xs text-slate-400">…</p>
                    ) : samples[c.id].length === 0 ? (
                      <p className="px-4 py-3 text-xs text-slate-400">{t("hc.noSamples")}</p>
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {[...samples[c.id]].reverse().map((s, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-3 px-4 py-2 text-xs">
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
