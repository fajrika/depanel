"use client";

import { useCallback, useEffect, useState } from "react";
import TimeField from "@/components/TimeField";
import { useLang } from "@/lib/i18n";

type SshOpt = { id: string; name: string; host: string; port: number; username: string };
type GdriveDest = { id: string; name: string; config: { gdriveConnected?: boolean; gdriveUserEmail?: string } };

type Run = {
  id: string;
  status: string;
  message: string | null;
  sizeBytes: number | null;
  location: string | null;
  startedAt: string;
  endedAt: string | null;
};

type Job = {
  id: string;
  name: string;
  sourcePath: string;
  destType: string;
  destPath: string | null;
  destGdriveId: string | null;
  scheduleType: string;
  timeAt: string | null;
  dayOn: number | null;
  cronExpr: string | null;
  timezone: string;
  retention: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  sourceSsh: { id: string; name: string; host: string } | null;
  destSsh: { id: string; name: string; host: string } | null;
  runs: Run[];
};

const DAY_NAMES = ["dcp.day.0", "dcp.day.1", "dcp.day.2", "dcp.day.3", "dcp.day.4", "dcp.day.5", "dcp.day.6"];

function schedLabel(j: Job): string {
  const { t } = useLang();
  if (j.scheduleType === "manual") return t("dcp.schedManual");
  if (j.scheduleType === "daily") return `${t("dcp.optDaily")} ${j.timeAt}`;
  if (j.scheduleType === "weekly") return `${t("dcp.optWeekly")}, ${t(DAY_NAMES[j.dayOn ?? 0])} ${j.timeAt}`;
  if (j.scheduleType === "monthly") return `${t("dcp.schedMonthly")} ${j.dayOn} ${j.timeAt}`;
  return `${t("dcp.schedCron")} ${j.cronExpr}`;
}

function destLabel(j: Job): string {
  const { t } = useLang();
  if (j.destType === "local") return `💾 ${t("dcp.localWord")} ${j.destPath ?? ""}`;
  if (j.destType === "gdrive") return "📂 Google Drive";
  return `🔐 SSH ${j.destSsh?.name ?? ""} ${j.destPath ?? ""}`;
}

function fmtBytes(n?: number | null): string {
  if (!n) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
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

export default function DirClonePage() {
  const { t } = useLang();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sshs, setSshs] = useState<SshOpt[]>([]);
  const [dests, setDests] = useState<GdriveDest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // form state
  const [fName, setFName] = useState("");
  const [fSrcSsh, setFSrcSsh] = useState("");
  const [fSrcPath, setFSrcPath] = useState("");
  const [fDestType, setFDestType] = useState<"local" | "gdrive" | "ssh">("local");
  const [fDestPath, setFDestPath] = useState("");
  const [fDestSsh, setFDestSsh] = useState("");
  const [fDestGdrive, setFDestGdrive] = useState("");
  const [fType, setFType] = useState("manual");
  const [fTime, setFTime] = useState("02:00");
  const [fDay, setFDay] = useState(1);
  const [fDate, setFDate] = useState(1);
  const [fCron, setFCron] = useState("0 2 * * *");
  const [fRetention, setFRetention] = useState("0");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [jRes, sRes, dRes] = await Promise.all([
        fetch("/api/dirclone"),
        fetch("/api/db/ssh"),
        fetch("/api/db/destinations"),
      ]);
      if (jRes.ok) setJobs((await jRes.json()).data ?? []);
      if (sRes.ok) setSshs((await sRes.json()).data ?? []);
      if (dRes.ok) setDests((await dRes.json()).data ?? []);
    } catch {
      /* biarkan data lama */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setFName("");
    setFSrcSsh("");
    setFSrcPath("");
    setFDestType("local");
    setFDestPath("");
    setFDestSsh("");
    setFDestGdrive("");
    setFType("manual");
    setFTime("02:00");
    setFDay(1);
    setFDate(1);
    setFCron("0 2 * * *");
    setFRetention("0");
  }

  function startEdit(j: Job) {
    setEditId(j.id);
    setFName(j.name);
    setFSrcSsh(j.sourceSsh?.id ?? "");
    setFSrcPath(j.sourcePath);
    setFDestType(j.destType as "local" | "gdrive" | "ssh");
    setFDestPath(j.destPath ?? "");
    setFDestSsh(j.destSsh?.id ?? "");
    setFDestGdrive(j.destGdriveId ?? "");
    setFType(j.scheduleType);
    setFTime(j.timeAt ?? "02:00");
    setFDay(j.dayOn ?? 1);
    setFDate(j.dayOn ?? 1);
    setFCron(j.cronExpr ?? "0 2 * * *");
    setFRetention(String(j.retention));
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payload: Record<string, unknown> = {
      name: fName,
      sourceSshId: fSrcSsh,
      sourcePath: fSrcPath,
      destType: fDestType,
      destPath: fDestType !== "local" ? fDestPath : fDestPath,
      destSshId: fDestType === "ssh" ? fDestSsh : "",
      destGdriveId: fDestType === "gdrive" ? fDestGdrive : "",
      scheduleType: fType,
      timeAt: fType === "daily" || fType === "weekly" || fType === "monthly" ? fTime : "",
      dayOn: fType === "weekly" ? fDay : fType === "monthly" ? fDate : null,
      cronExpr: fType === "cron" ? fCron : "",
      retention: Number(fRetention) || 0,
    };
    const url = editId ? `/api/dirclone/${editId}` : "/api/dirclone";
    const method = editId ? "PATCH" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const d = await res.json();
    setBusy(false);
    if (!res.ok || !d.ok) {
      setMsg({ text: d.message ?? t("dcp.saveFailed"), ok: false });
      return;
    }
    setMsg({ text: editId ? t("dcp.jobUpdated") : t("dcp.jobCreated"), ok: true });
    setEditId(null);
    setShowForm(false);
    resetForm();
    load();
  }

  async function runJob(j: Job) {
    setBusy(true);
    const res = await fetch(`/api/dirclone/${j.id}/run`, { method: "POST" });
    const d = await res.json();
    setBusy(false);
    setMsg(d.ok ? { text: `${t("dcp.cloneStarted1")} "${j.name}" ${t("dcp.cloneStarted2")}`, ok: true } : { text: d.message ?? t("dcp.failed"), ok: false });
    setTimeout(load, 1500);
  }

  async function toggleEnabled(j: Job) {
    await fetch(`/api/dirclone/${j.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !j.enabled }),
    });
    load();
  }

  async function remove(j: Job) {
    if (!confirm(`${t("dcp.confirmDelJob")} "${j.name}" ${t("dcp.confirmDelJob2")}?`)) return;
    await fetch(`/api/dirclone/${j.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{t("dcp.title")}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("dcp.subtitle")}
          </p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditId(null); if (!showForm) resetForm(); }} className={btnPrimary}>
          {showForm ? t("dcp.closeForm") : t("dcp.createJobClone")}
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
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editId ? t("dcp.editJob") : t("dcp.createJob")}</h2>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{t("dcp.close")}</button>
          </div>

          <div className="flex flex-wrap gap-4">
            <div><label className={label}>{t("dcp.jobName")}</label><input required value={fName} onChange={(e) => setFName(e.target.value)} placeholder={t("dcp.phJobName")} className={`${input} mt-1 w-52`} /></div>
            <div>
              <label className={label}>{t("dcp.sourceSshLabel")}</label>
              <select required value={fSrcSsh} onChange={(e) => setFSrcSsh(e.target.value)} className={`${input} mt-1 w-72`}>
                <option value="">{t("dcp.phPickSsh")}</option>
                {sshs.map((s) => (<option key={s.id} value={s.id}>{s.name} ({s.username}@{s.host}:{s.port})</option>))}
              </select>
              {sshs.length === 0 && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{t("dcp.noSshHint")}</p>}
            </div>
            <div><label className={label}>{t("dcp.sourceDirLabel")}</label><input required value={fSrcPath} onChange={(e) => setFSrcPath(e.target.value)} placeholder="/var/www/html" className={`${input} mt-1 w-64 font-mono`} /></div>
          </div>

          <div>
            <label className={label}>{t("dcp.cloneDestLabel")}</label>
            <div className="mt-2 flex gap-2">
              {[{ v: "local", l: t("dcp.destLocal") }, { v: "gdrive", l: "📂 Google Drive" }, { v: "ssh", l: t("dcp.destSsh") }].map((o) => (
                <button type="button" key={o.v} onClick={() => setFDestType(o.v as typeof fDestType)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${fDestType === o.v ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}>{o.l}</button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              {fDestType === "local" && (
                <div className="w-full"><label className={label}>{t("dcp.destPathLocalLabel")}</label><input required value={fDestPath} onChange={(e) => setFDestPath(e.target.value)} placeholder="/app/data/clones" className={`${input} mt-1 w-full max-w-lg font-mono`} /></div>
              )}
              {fDestType === "gdrive" && (
                <>
                  <div>
                    <label className={label}>{t("dcp.gdriveConnLabel")}</label>
                    <select required value={fDestGdrive} onChange={(e) => setFDestGdrive(e.target.value)} className={`${input} mt-1 w-72`}>
                      <option value="">{t("dcp.phPickDest")}</option>
                      {dests.filter((d) => d.config.gdriveConnected).map((d) => (<option key={d.id} value={d.id}>{d.name}{d.config.gdriveUserEmail ? ` (${d.config.gdriveUserEmail})` : ""}</option>))}
                    </select>
                    {dests.filter((d) => d.config.gdriveConnected).length === 0 && (
                      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{t("dcp.noGdriveHint")}</p>
                    )}
                  </div>
                  <div className="flex-1"><label className={label}>{t("dcp.gdriveFolderId")}</label><input required value={fDestPath} onChange={(e) => setFDestPath(e.target.value)} placeholder="1AbCdEf..." className={`${input} mt-1 w-full max-w-md font-mono`} /></div>
                </>
              )}
              {fDestType === "ssh" && (
                <>
                  <div>
                    <label className={label}>{t("dcp.destSshLabel")}</label>
                    <select required value={fDestSsh} onChange={(e) => setFDestSsh(e.target.value)} className={`${input} mt-1 w-72`}>
                      <option value="">{t("dcp.phPickSsh")}</option>
                      {sshs.filter((s) => s.id !== fSrcSsh).map((s) => (<option key={s.id} value={s.id}>{s.name} ({s.username}@{s.host}:{s.port})</option>))}
                    </select>
                  </div>
                  <div className="flex-1"><label className={label}>{t("dcp.destFilePathLabel")}</label><input required value={fDestPath} onChange={(e) => setFDestPath(e.target.value)} placeholder="/backups/web.tar.gz" className={`${input} mt-1 w-full max-w-md font-mono`} /></div>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className={label}>{t("dcp.scheduleLabel")}</label>
              <select value={fType} onChange={(e) => setFType(e.target.value)} className={`${input} mt-1`}>
                <option value="manual">{t("dcp.optManual")}</option>
                <option value="daily">{t("dcp.optDaily")}</option>
                <option value="weekly">{t("dcp.optWeekly")}</option>
                <option value="monthly">{t("dcp.optMonthly")}</option>
                <option value="cron">{t("dcp.optCron")}</option>
              </select>
            </div>
            {fType === "weekly" && (
              <div><label className={label}>{t("dcp.dayLabel")}</label><select value={fDay} onChange={(e) => setFDay(Number(e.target.value))} className={`${input} mt-1`}>{DAY_NAMES.map((d, i) => (<option key={i} value={i}>{t(d)}</option>))}</select></div>
            )}
            {fType === "monthly" && (
              <div><label className={label}>{t("dcp.dateLabel")}</label><select value={fDate} onChange={(e) => setFDate(Number(e.target.value))} className={`${input} mt-1`}>{Array.from({ length: 28 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}</option>))}</select></div>
            )}
            {fType !== "cron" && fType !== "manual" ? (
              <div><label className={label}>{t("dcp.timeLabel")}</label><div className="mt-1"><TimeField value={fTime} onChange={setFTime} /></div></div>
            ) : fType === "cron" ? (
              <div><label className={label}>{t("dcp.cronHelp")}</label><input value={fCron} onChange={(e) => setFCron(e.target.value)} placeholder="0 2 * * *" className={`${input} mt-1 w-40 font-mono`} /></div>
            ) : null}
            <div><label className={label}>{t("dcp.retentionLabel")}</label><input type="number" min="0" value={fRetention} onChange={(e) => setFRetention(e.target.value)} className={`${input} mt-1 w-20`} /></div>
          </div>

          <div className="flex justify-end">
            <button disabled={busy} className={btnPrimary}>{busy ? "…" : editId ? t("dcp.saveEdit") : t("dcp.createJobBtn")}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
      ) : jobs.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
          {t("dcp.noJobs")}
        </p>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <div key={j.id} className={`${card} overflow-hidden`}>
              <div className="flex flex-wrap items-center gap-3 p-4">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${j.lastStatus === "success" ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : j.lastStatus === "failed" ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900" : j.lastStatus === "running" ? "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-400 dark:ring-sky-900" : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"}`}>
                  {j.lastStatus ?? t("dcp.notRunYet")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{j.name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {j.sourceSsh?.name ?? "?"}:{j.sourcePath} → {destLabel(j)} · {schedLabel(j)}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    {t("dcp.lastRun")} {fmtTime(j.lastRunAt)} {j.retention > 0 ? `· ${t("dcp.retentionShort")} ${j.retention}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                  <button onClick={() => toggleEnabled(j)} disabled={busy} title={j.enabled ? t("dcp.disableTitle") : t("dcp.enableTitle")}
                    className={`rounded-full px-2.5 py-1 font-medium ring-1 transition ${j.enabled ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"}`}>
                    {j.enabled ? t("dcp.active") : t("dcp.inactive")}
                  </button>
                  <button onClick={() => runJob(j)} disabled={busy} className="rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300">{t("dcp.runNow")}</button>
                  <button onClick={() => startEdit(j)} disabled={busy} className="rounded-lg px-2.5 py-1.5 font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">{t("dcp.edit")}</button>
                  <button onClick={() => remove(j)} disabled={busy} className="rounded-lg px-2.5 py-1.5 font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950">{t("dcp.delete")}</button>
                  <button onClick={() => setExpanded(expanded === j.id ? null : j.id)} className="rounded-lg px-2.5 py-1.5 font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
                    {expanded === j.id ? t("dcp.historyOpen") : t("dcp.historyClosed")}
                  </button>
                </div>
              </div>

              {expanded === j.id && (
                <div className="border-t border-slate-100 dark:border-slate-800">
                  {j.runs.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-slate-400">{t("dcp.noRuns")}</p>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {j.runs.map((r) => (
                        <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs">
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${r.status === "success" ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : r.status === "failed" ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900" : "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-400 dark:ring-sky-900"}`}>{r.status}</span>
                          <span className="text-slate-500 dark:text-slate-400">{fmtTime(r.startedAt)}</span>
                          <span className="tabular-nums text-slate-500 dark:text-slate-400">{fmtBytes(r.sizeBytes)}</span>
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-400">{r.location ?? r.message}</span>
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
