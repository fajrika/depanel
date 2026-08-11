"use client";

import { useCallback, useEffect, useState } from "react";
import TimeField from "@/components/TimeField";
import { useLang } from "@/lib/i18n";

type SshOpt = { id: string; name: string; host: string; port: number; username: string };

type Run = {
  id: string;
  status: string;
  exitCode: number | null;
  output: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
};

type Job = {
  id: string;
  name: string;
  sshId: string;
  command: string;
  scheduleType: string;
  timeAt: string | null;
  dayOn: number | null;
  cronExpr: string | null;
  timezone: string;
  timeoutSec: number;
  enabled: boolean;
  lastStatus: string | null;
  lastRunAt: string | null;
  ssh: { id: string; name: string; host: string } | null;
  runs: Run[];
};

const DAY_NAMES = ["sshcmd.day.0", "sshcmd.day.1", "sshcmd.day.2", "sshcmd.day.3", "sshcmd.day.4", "sshcmd.day.5", "sshcmd.day.6"];

function schedLabel(j: Job): string {
  const { t } = useLang();
  if (j.scheduleType === "manual") return t("sshcmd.schedManual");
  if (j.scheduleType === "daily") return `${t("sshcmd.optDaily")} ${j.timeAt}`;
  if (j.scheduleType === "weekly") return `${t("sshcmd.optWeekly")}, ${t(DAY_NAMES[j.dayOn ?? 0])} ${j.timeAt}`;
  if (j.scheduleType === "monthly") return `${t("sshcmd.schedMonthly")} ${j.dayOn} ${j.timeAt}`;
  return `${t("sshcmd.schedCron")} ${j.cronExpr}`;
}

function fmtTime(s?: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const label = "block text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btnPrimary = "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

export default function SshCmdPage() {
  const { t } = useLang();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sshs, setSshs] = useState<SshOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // form state
  const [fName, setFName] = useState("");
  const [fSsh, setFSsh] = useState("");
  const [fCommand, setFCommand] = useState("");
  const [fType, setFType] = useState("manual");
  const [fTime, setFTime] = useState("02:00");
  const [fDay, setFDay] = useState(1);
  const [fDate, setFDate] = useState(1);
  const [fCron, setFCron] = useState("0 2 * * *");
  const [fTimeout, setFTimeout] = useState("60");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [jRes, sRes] = await Promise.all([fetch("/api/sshcmd"), fetch("/api/db/ssh")]);
      if (jRes.ok) setJobs((await jRes.json()).data ?? []);
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
    setFCommand("");
    setFType("manual");
    setFTime("02:00");
    setFDay(1);
    setFDate(1);
    setFCron("0 2 * * *");
    setFTimeout("60");
  }

  function startEdit(j: Job) {
    setEditId(j.id);
    setFName(j.name);
    setFSsh(j.sshId);
    setFCommand(j.command);
    setFType(j.scheduleType);
    setFTime(j.timeAt ?? "02:00");
    setFDay(j.dayOn ?? 1);
    setFDate(j.dayOn ?? 1);
    setFCron(j.cronExpr ?? "0 2 * * *");
    setFTimeout(String(j.timeoutSec));
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payload: Record<string, unknown> = {
      name: fName,
      sshId: fSsh,
      command: fCommand,
      scheduleType: fType,
      timeAt: fType === "daily" || fType === "weekly" || fType === "monthly" ? fTime : "",
      dayOn: fType === "weekly" ? fDay : fType === "monthly" ? fDate : null,
      cronExpr: fType === "cron" ? fCron : "",
      timeoutSec: Number(fTimeout) || 60,
    };
    const url = editId ? `/api/sshcmd/${editId}` : "/api/sshcmd";
    const method = editId ? "PATCH" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const d = await res.json();
    setBusy(false);
    if (!res.ok || !d.ok) {
      setMsg({ text: d.message ?? t("sshcmd.saveFailed"), ok: false });
      return;
    }
    setMsg({ text: editId ? t("sshcmd.jobUpdated") : t("sshcmd.jobCreated"), ok: true });
    setEditId(null);
    setShowForm(false);
    resetForm();
    load();
  }

  async function runJob(j: Job) {
    setBusy(true);
    const res = await fetch(`/api/sshcmd/${j.id}/run`, { method: "POST" });
    const d = await res.json();
    setBusy(false);
    setMsg(d.ok ? { text: `${t("sshcmd.runStarted1")} "${j.name}" ${t("sshcmd.runStarted2")}`, ok: true } : { text: d.message ?? t("sshcmd.failed"), ok: false });
    setTimeout(load, 1500);
  }

  async function toggleEnabled(j: Job) {
    await fetch(`/api/sshcmd/${j.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !j.enabled }),
    });
    load();
  }

  async function remove(j: Job) {
    if (!confirm(`${t("sshcmd.confirmDelJob")} "${j.name}"${t("sshcmd.confirmDelJob2")}`)) return;
    await fetch(`/api/sshcmd/${j.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{t("sshcmd.title")}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("sshcmd.subtitle")}
          </p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditId(null); if (!showForm) resetForm(); }} className={btnPrimary}>
          {showForm ? t("sshcmd.closeForm") : t("sshcmd.addBtn")}
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
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editId ? t("sshcmd.formTitleEdit") : t("sshcmd.formTitleCreate")}</h2>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{t("sshcmd.closeForm")}</button>
          </div>

          <div className="flex flex-wrap gap-4">
            <div><label className={label}>{t("sshcmd.jobName")}</label><input required value={fName} onChange={(e) => setFName(e.target.value)} placeholder={t("sshcmd.phJobName")} className={`${input} mt-1 w-52`} /></div>
            <div>
              <label className={label}>{t("sshcmd.sshLabel")}</label>
              <select required value={fSsh} onChange={(e) => setFSsh(e.target.value)} className={`${input} mt-1 w-72`}>
                <option value="">{t("sshcmd.phPickSsh")}</option>
                {sshs.map((s) => (<option key={s.id} value={s.id}>{s.name} ({s.username}@{s.host}:{s.port})</option>))}
              </select>
              {sshs.length === 0 && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{t("sshcmd.noSshHint")}</p>}
            </div>
            <div className="w-full"><label className={label}>{t("sshcmd.commandLabel")}</label><textarea required value={fCommand} onChange={(e) => setFCommand(e.target.value)} placeholder={t("sshcmd.phCommand")} rows={3} className={`${input} mt-1 w-full max-w-xl font-mono`} /></div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className={label}>{t("sshcmd.scheduleLabel")}</label>
              <select value={fType} onChange={(e) => setFType(e.target.value)} className={`${input} mt-1`}>
                <option value="manual">{t("sshcmd.optManual")}</option>
                <option value="daily">{t("sshcmd.optDaily")}</option>
                <option value="weekly">{t("sshcmd.optWeekly")}</option>
                <option value="monthly">{t("sshcmd.optMonthly")}</option>
                <option value="cron">{t("sshcmd.optCron")}</option>
              </select>
            </div>
            {fType === "weekly" && (
              <div><label className={label}>{t("sshcmd.dayLabel")}</label><select value={fDay} onChange={(e) => setFDay(Number(e.target.value))} className={`${input} mt-1`}>{DAY_NAMES.map((d, i) => (<option key={i} value={i}>{t(d)}</option>))}</select></div>
            )}
            {fType === "monthly" && (
              <div><label className={label}>{t("sshcmd.dateLabel")}</label><select value={fDate} onChange={(e) => setFDate(Number(e.target.value))} className={`${input} mt-1`}>{Array.from({ length: 28 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}</option>))}</select></div>
            )}
            {fType !== "cron" && fType !== "manual" ? (
              <div><label className={label}>{t("sshcmd.timeLabel")}</label><div className="mt-1"><TimeField value={fTime} onChange={setFTime} /></div></div>
            ) : fType === "cron" ? (
              <div><label className={label}>{t("sshcmd.cronHelp")}</label><input value={fCron} onChange={(e) => setFCron(e.target.value)} placeholder="0 2 * * *" className={`${input} mt-1 w-40 font-mono`} /></div>
            ) : null}
            <div><label className={label}>{t("sshcmd.timeoutLabel")}</label><input type="number" min="1" max="3600" value={fTimeout} onChange={(e) => setFTimeout(e.target.value)} className={`${input} mt-1 w-24`} /></div>
          </div>

          <div className="flex justify-end">
            <button disabled={busy} className={btnPrimary}>{busy ? "…" : editId ? t("sshcmd.saveEdit") : t("sshcmd.createBtn")}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
      ) : jobs.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
          {t("sshcmd.noJobs")}
        </p>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <div key={j.id} className={`${card} overflow-hidden`}>
              <div className="flex flex-wrap items-center gap-3 p-4">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${j.lastStatus === "success" ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : j.lastStatus === "failed" ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900" : j.lastStatus === "running" ? "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-400 dark:ring-sky-900" : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"}`}>
                  {j.lastStatus ?? t("sshcmd.notRunYet")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{j.name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {j.ssh?.name ?? "?"} → {j.command}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    {t("sshcmd.lastRun")} {fmtTime(j.lastRunAt)} · {schedLabel(j)} · {t("sshcmd.timeoutShort")} {j.timeoutSec}s
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                  <button onClick={() => toggleEnabled(j)} disabled={busy} title={j.enabled ? t("sshcmd.disableTitle") : t("sshcmd.enableTitle")}
                    className={`rounded-full px-2.5 py-1 font-medium ring-1 transition ${j.enabled ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"}`}>
                    {j.enabled ? t("sshcmd.active") : t("sshcmd.inactive")}
                  </button>
                  <button onClick={() => runJob(j)} disabled={busy} className="rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300">{t("sshcmd.runNow")}</button>
                  <button onClick={() => startEdit(j)} disabled={busy} className="rounded-lg px-2.5 py-1.5 font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">{t("sshcmd.edit")}</button>
                  <button onClick={() => remove(j)} disabled={busy} className="rounded-lg px-2.5 py-1.5 font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950">{t("sshcmd.delete")}</button>
                  <button onClick={() => setExpanded(expanded === j.id ? null : j.id)} className="rounded-lg px-2.5 py-1.5 font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
                    {expanded === j.id ? t("sshcmd.historyOpen") : t("sshcmd.historyClosed")}
                  </button>
                </div>
              </div>

              {expanded === j.id && (
                <div className="border-t border-slate-100 dark:border-slate-800">
                  {j.runs.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-slate-400">{t("sshcmd.noRuns")}</p>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {j.runs.map((r) => (
                        <div key={r.id} className="space-y-1.5 px-4 py-2.5 text-xs">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${r.status === "success" ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : r.status === "failed" ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900" : "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-400 dark:ring-sky-900"}`}>{r.status}</span>
                            <span className="text-slate-500 dark:text-slate-400">{fmtTime(r.startedAt)}</span>
                            {r.exitCode != null && <span className="tabular-nums text-slate-500 dark:text-slate-400">{t("sshcmd.runExit")} {r.exitCode}</span>}
                          </div>
                          {r.output && (
                            <>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t("sshcmd.outputLabel")}</p>
                              <pre className="max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">{r.output}</pre>
                            </>
                          )}
                          {r.error && <p className="text-red-500">{r.error}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
