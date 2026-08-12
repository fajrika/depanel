"use client";

import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type SshOpt = { id: string; name: string; host: string; port: number; username: string };

type Hc = {
  id: string;
  name: string;
  command: string;
  intervalMin: number;
  timeoutSec: number;
  enabled: boolean;
  lastStatus: string | null;
  lastOutput: string | null;
  lastRunAt: string | null;
};

type Group = {
  ssh: { id: string; name: string; host: string };
  checks: Hc[];
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

export default function SshHealthPage() {
  const { t } = useLang();
  const [groups, setGroups] = useState<Group[]>([]);
  const [sshs, setSshs] = useState<SshOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState<string | null>(null);

  const [fName, setFName] = useState("");
  const [fSsh, setFSsh] = useState("");
  const [fCmd, setFCmd] = useState("");
  const [fInterval, setFInterval] = useState("1");
  const [fTimeout, setFTimeout] = useState("30");

  const load = useCallback(async () => {
    try {
      const [gRes, sRes] = await Promise.all([fetch("/api/sshhealth"), fetch("/api/db/ssh")]);
      if (gRes.ok) setGroups((await gRes.json()).data ?? []);
      if (sRes.ok) setSshs((await sRes.json()).data ?? []);
    } catch {
      /* biarkan data lama */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setFName("");
    setFSsh("");
    setFCmd("");
    setFInterval("1");
    setFTimeout("30");
  }

  function startEdit(c: Hc, sshId: string) {
    setEditId(c.id);
    setFName(c.name);
    setFSsh(sshId);
    setFCmd(c.command);
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
      sshId: fSsh,
      command: fCmd,
      intervalMin: Number(fInterval) || 1,
      timeoutSec: Number(fTimeout) || 30,
    };
    const res = await fetch(editId ? `/api/sshhealth/${editId}` : "/api/sshhealth", {
      method: editId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok || !d.ok) {
      setMsg({ text: d.message ?? t("sh.savedErr"), ok: false });
      return;
    }
    setMsg({ text: editId ? t("sh.updated") : t("sh.created"), ok: true });
    setEditId(null);
    setShowForm(false);
    resetForm();
    load();
  }

  async function checkNow(c: Hc) {
    setChecking(c.id);
    const res = await fetch(`/api/sshhealth/${c.id}/check`, { method: "POST" });
    const d = await res.json();
    setChecking(null);
    setMsg({ text: d.ok && d.data?.ok ? t("sh.checkedOk") : d.message ?? t("sh.checkedFail"), ok: d.ok && d.data?.ok });
    load();
  }

  async function toggleEnabled(c: Hc) {
    await fetch(`/api/sshhealth/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !c.enabled }),
    });
    load();
  }

  async function remove(c: Hc) {
    if (!confirm(`${t("sh.deleteConfirm")} "${c.name}"${t("sh.deleteConfirm2")}`)) return;
    await fetch(`/api/sshhealth/${c.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">🧪 {t("sh.title")}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("sh.subtitle")}</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditId(null); if (!showForm) resetForm(); }} className={btnPrimary}>
          {showForm ? t("sh.close") : t("sh.add")}
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
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editId ? t("sh.editTitle") : t("sh.createTitle")}</h2>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">✕</button>
          </div>

          <div className="flex flex-wrap gap-4">
            <div><label className={label}>{t("sh.name")}</label><input required value={fName} onChange={(e) => setFName(e.target.value)} placeholder={t("sh.namePh")} className={`${input} mt-1 w-48`} /></div>
            <div>
              <label className={label}>{t("sh.ssh")}</label>
              <select required value={fSsh} onChange={(e) => setFSsh(e.target.value)} className={`${input} mt-1 w-72`}>
                <option value="">—</option>
                {sshs.map((s) => (<option key={s.id} value={s.id}>{s.name} ({s.username}@{s.host}:{s.port})</option>))}
              </select>
              {sshs.length === 0 && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{t("sh.noSsh")}</p>}
            </div>
          </div>

          <div>
            <label className={label}>{t("sh.command")}</label>
            <input required value={fCmd} onChange={(e) => setFCmd(e.target.value)} placeholder={t("sh.commandPh")} className={`${input} mt-1 w-full max-w-xl font-mono`} />
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{t("sh.commandHint")}</p>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div><label className={label}>{t("sh.interval")}</label><input type="number" min="1" max="1440" value={fInterval} onChange={(e) => setFInterval(e.target.value)} className={`${input} mt-1 w-20`} /></div>
            <div><label className={label}>{t("sh.timeout")}</label><input type="number" min="1" max="300" value={fTimeout} onChange={(e) => setFTimeout(e.target.value)} className={`${input} mt-1 w-20`} /></div>
          </div>

          <div className="flex justify-end">
            <button disabled={busy} className={btnPrimary}>{busy ? t("sh.saving") : t("sh.save")}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
      ) : groups.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
          {t("sh.empty")}
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.ssh.id);
            const downCount = g.checks.filter((c) => c.lastStatus === "down").length;
            return (
              <section key={g.ssh.id} className={card}>
                <button
                  onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g.ssh.id)) n.delete(g.ssh.id); else n.add(g.ssh.id); return n; })}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
                >
                  <span className={`text-slate-400 transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`}>▾</span>
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                    {g.ssh.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{g.ssh.name}</span>
                  <span className="text-[11px] text-slate-400">{g.ssh.host}</span>
                  {downCount > 0 && (
                    <span className="ml-auto rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900">
                      {downCount} {t("sh.down")}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-slate-400">{g.checks.length} app</span>
                </button>

                {!isCollapsed && (
                  <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                    {g.checks.map((c) => {
                      const ok = c.lastStatus === "healthy";
                      return (
                        <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm ring-1 ${ok ? "bg-emerald-500 text-white ring-emerald-600" : c.lastStatus === "down" ? "bg-red-500 text-white ring-red-600" : "bg-slate-200 text-slate-500 ring-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600"}`}>
                            {ok ? "✓" : c.lastStatus === "down" ? "✕" : "·"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{c.name}</p>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${ok ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : c.lastStatus === "down" ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900" : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"}`}>
                                {ok ? t("sh.healthy") : c.lastStatus === "down" ? t("sh.down") : t("sh.never")}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{c.command}</p>
                            <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                              {t("sh.lastCheck")}: {fmtTime(c.lastRunAt)} · {t("sh.output")}: {c.lastOutput ? c.lastOutput.slice(0, 120) : t("sh.noOutput")}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
                            <button onClick={() => toggleEnabled(c)} disabled={busy} className={`rounded-full px-2.5 py-1 font-medium ring-1 transition ${c.enabled ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"}`}>
                              {c.enabled ? `✓ ${t("sh.enabled")}` : t("sh.disabled")}
                            </button>
                            <button onClick={() => checkNow(c)} disabled={busy || checking === c.id} className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300">
                              {checking === c.id ? t("sh.checking") : t("sh.checkNow")}
                            </button>
                            <button onClick={() => startEdit(c, g.ssh.id)} disabled={busy} className="rounded-lg px-2 py-1.5 font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">{t("sh.edit")}</button>
                            <button onClick={() => remove(c)} disabled={busy} className="rounded-lg px-2 py-1.5 font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950">{t("sh.delete")}</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
