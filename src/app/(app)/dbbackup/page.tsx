"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TimeField from "@/components/TimeField";
import { useLang } from "@/lib/i18n";

type Conn = { id: string; name: string; host: string; port: number; username: string; sshId?: string | null; ssh?: { id: string; name: string } | null; jobCount: number };
type Ssh = { id: string; name: string; host: string; port: number; username: string; connCount: number };
type Team = { id: string; name: string };
type DestCfg = { host?: string; port?: number; secure?: boolean; username?: string; bucket?: string; region?: string; endpoint?: string; accessKeyId?: string; clientId?: string; gdriveConnected?: boolean; gdriveUserEmail?: string };
type Dest = { id: string; type: "ftp" | "s3" | "gdrive"; name: string; jobCount: number; config: DestCfg };
type Run = { id: string; status: string; message: string | null; sizeBytes: number | null; sqlSizeBytes: number | null; location: string | null; startedAt: string; endedAt: string | null };
type Job = {
  id: string;
  name: string;
  connection: { id: string; name: string; host: string };
  databases: string[];
  scheduleType: string;
  timeAt: string | null;
  dayOn: number | null;
  cronExpr: string | null;
  destType: string;
  destId: string | null;
  destPath: string | null;
  dest: { id: string; type: string; name: string } | null;
  retention: number;
  compression: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
};

const DAY_NAMES = ["dbp.day.0", "dbp.day.1", "dbp.day.2", "dbp.day.3", "dbp.day.4", "dbp.day.5", "dbp.day.6"];

const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const label = "block text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btnPrimary =
  "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

function fmtSize(n: number | null): string {
  if (!n) return "—";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function fmtDuration(startedAt: string, endedAt: string | null): string | null {
  const { t } = useLang();
  if (!endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (isNaN(ms) || ms < 0) return null;
  const totalSecs = Math.round(ms / 1000);
  if (totalSecs < 60) return `${totalSecs} ${t("dbp.unitSec")}`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins < 60) return secs ? `${mins} ${t("dbp.unitMin")} ${secs} ${t("dbp.unitSec")}` : `${mins} ${t("dbp.unitMin")}`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins ? `${hours} ${t("dbp.unitHr")} ${remMins} ${t("dbp.unitMin")}` : `${hours} ${t("dbp.unitHr")}`;
}

function scheduleLabel(j: Job): string {
  const { t } = useLang();
  if (j.scheduleType === "hourly") return t("dbp.optHourly");
  if (j.scheduleType === "daily") return `${t("dbp.optDaily")} ${j.timeAt}`;
  if (j.scheduleType === "weekly") return `${t("dbp.optWeekly")}, ${t(DAY_NAMES[j.dayOn ?? 0])} ${j.timeAt}`;
  if (j.scheduleType === "monthly") return `${t("dbp.schedMonthly")} ${j.dayOn} ${j.timeAt}`;
  return `${t("dbp.schedCron")} ${j.cronExpr}`;
}

function destLabel(j: Job): string {
  const { t } = useLang();
  if (j.destType === "local") return `📁 ${j.destPath}`;
  if (j.destType === "gdrive") return `📂 ${j.dest?.name ?? t("dbp.gdriveName")}`;
  if (j.destType === "ftp") return `🌐 ${j.dest?.name ?? "FTP"}`;
  return `☁️ ${j.dest?.name ?? "S3"}`;
}

export default function DbBackupPage() {
  const router = useRouter();
  const { t } = useLang();
  const [tab, setTab] = useState<"sumber" | "tujuan" | "job">("sumber");
  const [conns, setConns] = useState<Conn[]>([]);
  const [sshs, setSshs] = useState<Ssh[]>([]);
  const [dests, setDests] = useState<Dest[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // form koneksi
  const [showConnForm, setShowConnForm] = useState(false);
  const [nc, setNc] = useState({ name: "", host: "", port: "3306", username: "", password: "", useSsh: false, sshId: "" });
  const [editConnId, setEditConnId] = useState<string | null>(null);
  // form koneksi tujuan
  const [showDestForm, setShowDestForm] = useState(false);
  const [editDestId, setEditDestId] = useState<string | null>(null);
  const [ndType, setNdType] = useState<"ftp" | "s3" | "gdrive">("gdrive");
  const [ndName, setNdName] = useState("");
  const [ndCfg, setNdCfg] = useState<Record<string, string>>({});
  // clone
  const [teams, setTeams] = useState<Team[]>([]);
  const [cloneConnId, setCloneConnId] = useState<string | null>(null);
  const [cloneTeamId, setCloneTeamId] = useState("");
  // form job
  const [showJobForm, setShowJobForm] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [jName, setJName] = useState("");
  const [jConn, setJConn] = useState("");
  const [dbList, setDbList] = useState<string[] | null>(null);
  const [jDbs, setJDbs] = useState<Set<string>>(new Set());
  const [jType, setJType] = useState("daily");
  const [jTime, setJTime] = useState("02:00");
  const [jDay, setJDay] = useState(0);
  const [jDate, setJDate] = useState(1);
  const [jCron, setJCron] = useState("0 2 * * *");
  const [jDest, setJDest] = useState("local");
  const [jDestId, setJDestId] = useState("");
  const [jDestPath, setJDestPath] = useState("");
  const [jRetention, setJRetention] = useState(0);
  const [jCompression, setJCompression] = useState("brotli");
  // panel — selectedJobId always has a value when on job tab + not in form mode
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  // runs pagination
  const [runs, setRuns] = useState<Run[]>([]);
  const [runPage, setRunPage] = useState(1);
  const [runTotalPages, setRunTotalPages] = useState(0);
  const [runLoading, setRunLoading] = useState(false);
  // restore modal
  const [restoreRunId, setRestoreRunId] = useState<string | null>(null);
  const [restoreConnId, setRestoreConnId] = useState("");
  const [restoreDbList, setRestoreDbList] = useState<string[] | null>(null);
  const [restoreDbs, setRestoreDbs] = useState<Set<string>>(new Set());
  const [restoreOrigJob, setRestoreOrigJob] = useState<{ connId: string; connName: string; databases: string[] } | null>(null);
  const [restoreProgress, setRestoreProgress] = useState<{ pct: number; text: string } | null>(null);

  const load = useCallback(async () => {
    const [cRes, jRes, tRes, sRes, dRes] = await Promise.all([fetch("/api/db/connections"), fetch("/api/db/jobs"), fetch("/api/teams"), fetch("/api/db/ssh"), fetch("/api/db/destinations")]);
    if (cRes.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    const c = await cRes.json();
    const j = await jRes.json();
    const t = await tRes.json();
    const s = await sRes.json();
    const d = await dRes.json();
    setConns(c.data ?? []);
    setSshs(s.data ?? []);
    setDests(d.data ?? []);
    setJobs(j.data ?? []);
    setTeams(t.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // auto-refresh saat ada job running
  useEffect(() => {
    if (!jobs.some((j) => j.lastStatus === "running")) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [jobs, load]);

  const loadRuns = useCallback(async (jobId: string, page: number) => {
    setRunLoading(true);
    try {
      const res = await fetch(`/api/db/jobs/${jobId}/runs?page=${page}&limit=10`);
      const d = await res.json();
      if (d.ok) {
        setRuns(d.data);
        setRunPage(d.pagination.page);
        setRunTotalPages(d.pagination.totalPages);
      }
    } finally {
      setRunLoading(false);
    }
  }, []);

  // load runs when selected job changes
  useEffect(() => {
    if (selectedJobId) {
      setRuns([]);
      setRunPage(1);
      setRunTotalPages(0);
      loadRuns(selectedJobId, 1);
    }
  }, [selectedJobId, loadRuns]);

  // refresh runs after action (restore, delete, etc.)
  const refreshRuns = useCallback(() => {
    if (selectedJobId) loadRuns(selectedJobId, runPage);
  }, [selectedJobId, runPage, loadRuns]);

  // Handle OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ok = params.get("gdrive_ok");
    const err = params.get("gdrive_error");
    const t = params.get("tab");
    if (t === "tujuan") setTab("tujuan");
    if (ok) {
      setMsg({ text: `✅ ${t("dbp.msgGdriveConnected")} ${ok}`, ok: true });
      window.history.replaceState({}, "", window.location.pathname);
      load();
    } else if (err) {
      setMsg({ text: `❌ ${err}`, ok: false });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [load]);

  async function api(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || d.ok === false) {
      setMsg({ text: d.message ?? t("dbp.errGeneral"), ok: false });
      return false;
    }
    load();
    return true;
  }

  async function loadDatabases(connId: string, preserveSelection = false) {
    setJConn(connId);
    setDbList(null);
    if (!preserveSelection) setJDbs(new Set());
    if (!connId) return;
    const res = await fetch(`/api/db/connections/${connId}/databases`);
    const d = await res.json();
    if (d.ok) setDbList(d.data);
    else {
      setDbList([]);
      setMsg({ text: d.message ?? t("dbp.errLoadDatabases"), ok: false });
    }
  }

  function openRestoreModal(runId: string, job: { connection: { id: string; name: string }; databases: string[] }) {
    setRestoreRunId(runId);
    setRestoreOrigJob({ connId: job.connection.id, connName: job.connection.name, databases: job.databases });
    setRestoreConnId(job.connection.id);
    setRestoreDbs(new Set(job.databases));
    // load databases for default connection
    setRestoreDbList(null);
    fetch(`/api/db/connections/${job.connection.id}/databases`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setRestoreDbList(d.data); else setRestoreDbList([]); });
  }

  async function loadRestoreDatabases(connId: string) {
    setRestoreConnId(connId);
    setRestoreDbList(null);
    // reset to original databases if switching back to original connection
    if (connId === restoreOrigJob?.connId) {
      setRestoreDbs(new Set(restoreOrigJob.databases));
    } else {
      setRestoreDbs(new Set());
    }
    if (!connId) return;
    const res = await fetch(`/api/db/connections/${connId}/databases`);
    const d = await res.json();
    if (d.ok) setRestoreDbList(d.data);
    else setRestoreDbList([]);
  }

  async function doRestore() {
    if (!restoreRunId) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/db/runs/${restoreRunId}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetConnectionId: restoreConnId !== restoreOrigJob?.connId ? restoreConnId : undefined }),
    });
    const d = await res.json().catch(() => ({ message: `HTTP ${res.status} — ${t("dbp.errNoResponse")}` }));
    setRestoreRunId(null);

    if (!res.ok || d.ok === false) {
      setBusy(false);
      setMsg({ text: d.message ?? t("dbp.errStartRestore"), ok: false });
      return;
    }

    // Async restore started — poll for status
    const restoreId = d.data?.restoreId;
    setRestoreProgress({ pct: 0, text: t("dbp.restoreStarting") });

    const poll = async () => {
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const pRes = await fetch(`/api/db/restores/${restoreId}`);
        const p = await pRes.json().catch(() => null);
        if (!p?.ok) continue;
        if (p.data.status === "success") {
          setBusy(false);
          setRestoreProgress(null);
          const warnText = p.data.warnings?.length ? ` (${p.data.warnings.length} ${t("dbp.warnings")})` : "";
          setMsg({ text: `✓ ${t("dbp.restoreDone")}${warnText}`, ok: true });
          load();
          refreshRuns();
          return;
        }
        if (p.data.status === "failed") {
          setBusy(false);
          setRestoreProgress(null);
          setMsg({ text: `${t("dbp.restoreFailed")} ${p.data.message}`, ok: false });
          return;
        }
        // Update progress
        if (p.data.progressPct != null && p.data.progressText) {
          setRestoreProgress({ pct: p.data.progressPct, text: p.data.progressText });
        }
      }
      setBusy(false);
      setRestoreProgress(null);
      setMsg({ text: t("dbp.restoreStillRunning"), ok: true });
    };
    void poll();
  }

  async function createJob(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: jName,
      connectionId: jConn,
      databases: [...jDbs],
      scheduleType: jType,
      ...(jType === "cron" ? { cronExpr: jCron } : jType === "hourly" ? {} : { timeAt: jTime }),
      ...(jType === "weekly" ? { dayOn: jDay } : jType === "monthly" ? { dayOn: jDate } : {}),
      destType: jDest,
      ...(jDest === "local"
        ? { destPath: jDestPath }
        : { destId: jDestId, destPath: jDestPath }),
      retention: jRetention,
      compression: jCompression,
    };
    const url = editJobId ? `/api/db/jobs/${editJobId}` : "/api/db/jobs";
    const method = editJobId ? "PATCH" : "POST";
    const ok = await api(url, method, body);
    if (ok) {
      setShowJobForm(false);
      setEditJobId(null);
      setJName("");
      setJDbs(new Set());
      setJDestPath("");
      setJDestId("");
      setJRetention(0);
      setJCompression("brotli");
      setMsg({ text: editJobId ? t("dbp.jobUpdated") : t("dbp.jobCreated"), ok: true });
    }
  }

  function openEdit(j: Job) {
    setEditJobId(j.id);
    setJName(j.name);
    setJConn(j.connection.id);
    setJDbs(new Set(j.databases));
    setJType(j.scheduleType);
    setJTime(j.timeAt ?? "02:00");
    setJDay(j.dayOn ?? 0);
    setJDate(j.dayOn ?? 1);
    setJCron(j.cronExpr ?? "0 2 * * *");
    setJDest(j.destType);
    setJDestId(j.destId ?? "");
    setJDestPath(j.destPath ?? "");
    setJRetention(j.retention);
    setJCompression(j.compression || "brotli");
    setShowJobForm(true);
    loadDatabases(j.connection.id, true);
  }

  // Mobile: open job detail in new page; desktop: inline select
  function selectJob(id: string) {
    if (window.innerWidth < 1024) {
      router.push(`/dbbackup/${id}`);
      return;
    }
    setSelectedJobId(selectedJobId === id ? null : id);
  }

  const selected = jobs.find((j) => j.id === selectedJobId) ?? null;

  if (forbidden) {
    return <p className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">{t("dbp.forbidden")}</p>;
  }

  const ND = (k: string) => ndCfg[k] ?? "";
  const setND = (k: string, v: string) => setNdCfg((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{t("dbp.title")}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t("dbp.subtitle")}
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800 w-fit">
        <button
          onClick={() => setTab("sumber")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "sumber" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
        >
          {t("dbp.tabSource")}
        </button>
        <button
          onClick={() => setTab("tujuan")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "tujuan" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
        >
          {t("dbp.tabDest")}
        </button>
        <button
          onClick={() => setTab("job")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "job" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
        >
          {t("dbp.tabJob")}
        </button>
      </div>

      {msg && (
        <div className={`flex items-start gap-2 whitespace-pre-wrap rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300" : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"}`}>
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {restoreProgress && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300">
          <p>{restoreProgress.text}</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-sky-200 dark:bg-sky-800">
            <div className="h-full rounded-full bg-sky-500 transition-all duration-1000" style={{ width: `${restoreProgress.pct}%` }} />
          </div>
        </div>
      )}

      {/* ===== TAB: SUMBER ===== */}
      {tab === "sumber" && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("dbp.sourceConnsTitle")}</h2>
            <button onClick={() => { setShowConnForm(!showConnForm); setEditConnId(null); setNc({ name: "", host: "", port: "3306", username: "", password: "", useSsh: false, sshId: "" }); }} className={btnPrimary}>
              {showConnForm ? t("dbp.closeForm") : t("dbp.addConn")}
            </button>
          </div>

          {showConnForm && (
            <form
              className={`${card} animate-fade-up mb-4 space-y-5`}
              onSubmit={async (e) => {
                e.preventDefault();
                const payload = { ...nc, port: Number(nc.port) || 3306, sshId: nc.useSsh ? nc.sshId : null };
                if (editConnId) {
                  const ok = await api(`/api/db/connections/${editConnId}`, "PATCH", payload);
                  if (ok) {
                    setShowConnForm(false);
                    setEditConnId(null);
                    setNc({ name: "", host: "", port: "3306", username: "", password: "", useSsh: false, sshId: "" });
                    setMsg({ text: t("dbp.connUpdated"), ok: true });
                  }
                } else {
                  const ok = await api("/api/db/connections", "POST", payload);
                  if (ok) {
                    setShowConnForm(false);
                    setNc({ name: "", host: "", port: "3306", username: "", password: "", useSsh: false, sshId: "" });
                    setMsg({ text: t("dbp.connSaved"), ok: true });
                  }
                }
              }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editConnId ? t("dbp.editConn") : t("dbp.createConn")}</h3>
                <button type="button" onClick={() => { setShowConnForm(false); setEditConnId(null); }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{t("dbp.close")}</button>
              </div>

              {/* RDBMS selector */}
              <div>
                <label className={label}>{t("dbp.dbType")}</label>
                <div className="mt-2 flex gap-2">
                  {[{ v: "mysql", l: "🐬 MySQL", active: true }, { v: "postgresql", l: "🐘 PostgreSQL", active: false }, { v: "sqlite", l: "🪶 SQLite", active: false }].map((o) => (
                    <button type="button" key={o.v} disabled={!o.active}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${o.active ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600"}`}
                    >{o.l}{!o.active && t("dbp.comingSoon")}</button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <div><label className={label}>{t("dbp.labelName")}</label><input required value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} placeholder={t("dbp.phConnName")} className={`${input} mt-1 w-56`} /></div>
                <div><label className={label}>{t("dbp.labelHost")}</label><input required value={nc.host} onChange={(e) => setNc({ ...nc, host: e.target.value })} placeholder="103.x.x.x" className={`${input} mt-1 w-56`} /></div>
                <div><label className={label}>{t("dbp.labelPort")}</label><input value={nc.port} onChange={(e) => setNc({ ...nc, port: e.target.value })} className={`${input} mt-1 w-24`} /></div>
                <div><label className={label}>{t("dbp.labelUsername")}</label><input required value={nc.username} onChange={(e) => setNc({ ...nc, username: e.target.value })} className={`${input} mt-1 w-44`} /></div>
                <div><label className={label}>{t("dbp.labelPassword")}</label><input type="password" value={nc.password} onChange={(e) => setNc({ ...nc, password: e.target.value })} placeholder={editConnId ? t("dbp.phPassUnchanged") : ""} className={`${input} mt-1 w-44`} /></div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                <label className={label}>{t("dbp.sshConnLabel")}</label>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setNc({ ...nc, useSsh: !nc.useSsh })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${nc.useSsh ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600"}`}
                  >
                    {nc.useSsh ? t("dbp.useSsh") : t("dbp.noSsh")}
                  </button>
                  {nc.useSsh && (
                    <select value={nc.sshId} onChange={(e) => setNc({ ...nc, sshId: e.target.value })} required className={`${input} w-72`}>
                      <option value="">{t("dbp.phPickSsh")}</option>
                      {sshs.map((s) => (<option key={s.id} value={s.id}>{s.name} ({s.username}@{s.host}:{s.port})</option>))}
                    </select>
                  )}
                </div>
                {nc.useSsh && sshs.length === 0 && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t("dbp.noSshHint")}</p>
                )}
                {nc.useSsh && (
                  <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">{t("dbp.sshTunnelHint")}</p>
                )}
              </div>

              <div className="flex justify-end">
                <button disabled={busy} className={btnPrimary}>{busy ? "…" : editConnId ? t("dbp.saveEdit") : t("dbp.testSave")}</button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          ) : conns.length === 0 ? (
            <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
              {t("dbp.noConns")}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {conns.map((c) => (
                <div key={c.id} className={`${card} flex items-center justify-between gap-3 !p-4`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{c.name}</p>
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">MySQL</span>
                    </div>
                    <p className="truncate text-xs text-slate-400">{c.username}@{c.host}:{c.port}{c.ssh ? ` · ${t("dbp.viaSsh")} ${c.ssh.name}` : ""} · {c.jobCount} {t("dbp.unitJob")}</p>
                  </div>
                  <div className="flex shrink-0 gap-2 text-xs">
                    <button onClick={() => { setEditConnId(c.id); setNc({ name: c.name, host: c.host, port: String(c.port), username: c.username, password: "", useSsh: !!c.sshId, sshId: c.sshId ?? "" }); setShowConnForm(true); }} className="font-medium text-slate-500 hover:underline dark:text-slate-400">{t("dbp.edit")}</button>
                    <button onClick={() => { setCloneConnId(c.id); setCloneTeamId(""); }} className="font-medium text-sky-600 hover:underline dark:text-sky-400">{t("dbp.clone")}</button>
                    <button onClick={() => confirm(`${t("dbp.confirmDelConn1")} "${c.name}" ${t("dbp.confirmDelConn2")}`) && api(`/api/db/connections/${c.id}`, "DELETE")} className="font-medium text-red-500 hover:underline">{t("dbp.delete")}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ===== TAB: TUJUAN ===== */}
      {tab === "tujuan" && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("dbp.destConnsTitle")}</h2>
            <button onClick={() => { setShowDestForm(!showDestForm); setEditDestId(null); setNdName(""); setNdCfg({}); setNdType("gdrive"); }} className={btnPrimary}>
              {showDestForm ? t("dbp.closeForm") : t("dbp.addDest")}
            </button>
          </div>

          {showDestForm && (
            <form
              className={`${card} animate-fade-up mb-4 space-y-5`}
              onSubmit={async (e) => {
                e.preventDefault();
                const cfg: Record<string, unknown> = { ...ndCfg };
                if (ndType === "ftp") { cfg.port = Number(cfg.port) || 21; cfg.secure = cfg.secure === "true" || cfg.secure === true; }
                if (ndType === "s3") { cfg.region = (cfg.region as string) || "auto"; }
                const body = { type: ndType, name: ndName, config: cfg };
                const url = editDestId ? `/api/db/destinations/${editDestId}` : "/api/db/destinations";
                const method = editDestId ? "PATCH" : "POST";
                const ok = await api(url, method, body);
                if (ok) {
                  setShowDestForm(false);
                  setEditDestId(null);
                  setNdName("");
                  setNdCfg({});
                  setMsg({ text: editDestId ? t("dbp.destUpdated") : t("dbp.destSaved"), ok: true });
                }
              }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editDestId ? t("dbp.editDest") : t("dbp.createDest")}</h3>
                <button type="button" onClick={() => { setShowDestForm(false); setEditDestId(null); }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{t("dbp.close")}</button>
              </div>

              <div>
                <label className={label}>{t("dbp.destType")}</label>
                <div className="mt-2 flex gap-2">
                  {[{ v: "ftp", l: "🌐 FTP" }, { v: "s3", l: "☁️ S3" }, { v: "gdrive", l: "📂 Google Drive" }].map((o) => (
                    <button type="button" key={o.v} disabled={!!editDestId && o.v !== ndType}
                      onClick={() => { setNdType(o.v as typeof ndType); setNdCfg({}); }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${ndType === o.v ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"} ${editDestId && o.v !== ndType ? "cursor-not-allowed opacity-50" : ""}`}
                    >{o.l}</button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <div><label className={label}>{t("dbp.labelName")}</label><input required value={ndName} onChange={(e) => setNdName(e.target.value)} placeholder={t("dbp.phDestName")} className={`${input} mt-1 w-56`} /></div>
                {ndType === "ftp" && (
                  <>
                    <div><label className={label}>{t("dbp.labelHost")}</label><input required value={ND("host")} onChange={(e) => setND("host", e.target.value)} placeholder="ftp.example.com" className={`${input} mt-1 w-52`} /></div>
                    <div><label className={label}>{t("dbp.labelPort")}</label><input value={ND("port") || "21"} onChange={(e) => setND("port", e.target.value)} className={`${input} mt-1 w-20`} /></div>
                    <div><label className={label}>{t("dbp.labelUsername")}</label><input required value={ND("username")} onChange={(e) => setND("username", e.target.value)} className={`${input} mt-1 w-40`} /></div>
                    <div><label className={label}>{t("dbp.labelPassword")}</label><input type="password" required={!editDestId} value={ND("password")} onChange={(e) => setND("password", e.target.value)} placeholder={editDestId ? t("dbp.phPassUnchanged") : ""} className={`${input} mt-1 w-40`} /></div>
                    <div className="flex items-center gap-2 pt-6">
                      <input id="ftp-secure" type="checkbox" checked={ND("secure") === "true"} onChange={(e) => setND("secure", e.target.checked ? "true" : "false")} className="h-4 w-4 accent-slate-900" />
                      <label htmlFor="ftp-secure" className="text-xs text-slate-500 dark:text-slate-400">{t("dbp.ftpsSecure")}</label>
                    </div>
                  </>
                )}
                {ndType === "s3" && (
                  <>
                    <div><label className={label}>{t("dbp.labelBucket")}</label><input required value={ND("bucket")} onChange={(e) => setND("bucket", e.target.value)} className={`${input} mt-1 w-40`} /></div>
                    <div><label className={label}>{t("dbp.labelRegion")}</label><input value={ND("region")} onChange={(e) => setND("region", e.target.value)} placeholder="ap-southeast-1" className={`${input} mt-1 w-36`} /></div>
                    <div><label className={label}>{t("dbp.endpointOpt")}</label><input value={ND("endpoint")} onChange={(e) => setND("endpoint", e.target.value)} placeholder="https://…" className={`${input} mt-1 w-56`} /></div>
                    <div><label className={label}>{t("dbp.accessKey")}</label><input required value={ND("accessKeyId")} onChange={(e) => setND("accessKeyId", e.target.value)} className={`${input} mt-1 w-44`} /></div>
                    <div><label className={label}>{t("dbp.secretKey")}</label><input required={!editDestId} type="password" value={ND("secretKey")} onChange={(e) => setND("secretKey", e.target.value)} placeholder={editDestId ? t("dbp.phPassUnchanged") : ""} className={`${input} mt-1 w-44`} /></div>
                  </>
                )}
                {ndType === "gdrive" && (
                  <>
                    <div className="w-full">
                      <label className={label}>{t("dbp.oauthClientId")}</label>
                      <input required value={ND("clientId")} onChange={(e) => setND("clientId", e.target.value)} placeholder="xxxx.apps.googleusercontent.com" className={`${input} mt-1 w-80`} />
                      <p className="mt-1 text-[11px] text-slate-400">{t("dbp.redirectUri")} <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">{typeof window !== "undefined" ? window.location.origin : ""}/api/db/gdrive/callback</code></p>
                    </div>
                    <div className="w-full">
                      <label className={label}>{t("dbp.oauthClientSecret")}</label>
                      <input type="password" required={!editDestId} value={ND("clientSecret")} onChange={(e) => setND("clientSecret", e.target.value)} placeholder={editDestId ? t("dbp.phPassUnchanged") : "GOCSPX-..."} className={`${input} mt-1 w-80`} />
                    </div>
                  </>
                )}
              </div>

              <div className="flex justify-end">
                <button disabled={busy} className={btnPrimary}>{busy ? "…" : editDestId ? t("dbp.saveEdit") : t("dbp.saveDest")}</button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          ) : dests.length === 0 ? (
            <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
              {t("dbp.noDests")}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {dests.map((d) => {
                const connected = d.config.gdriveConnected && !!d.config.gdriveUserEmail;
                return (
                  <div key={d.id} className={`${card} flex flex-col justify-between gap-3 !p-4`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {d.type === "ftp" ? "🌐" : d.type === "s3" ? "☁️" : "📂"} {d.name}
                        </p>
                        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">{d.type}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-400">
                        {d.type === "ftp" && `${d.config.username ?? ""}@${d.config.host ?? ""}:${d.config.port ?? 21}${d.config.secure ? " (FTPS)" : ""}`}
                        {d.type === "s3" && `s3://${d.config.bucket ?? ""}${d.config.region && d.config.region !== "auto" ? ` · ${d.config.region}` : ""}`}
                        {d.type === "gdrive" && (connected ? `${t("dbp.gdriveConnectedAs")} ${d.config.gdriveUserEmail}` : t("dbp.gdriveNotLogged"))}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{d.jobCount} {t("dbp.jobUsing")}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {d.type === "gdrive" && (
                        <a href={`/api/db/gdrive/auth?destId=${d.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white transition hover:bg-blue-500">
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#fff"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" opacity=".8"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" opacity=".6"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" opacity=".9"/></svg>
                          {connected ? t("dbp.loginAgain") : t("dbp.loginGoogle")}
                        </a>
                      )}
                      <button onClick={() => {
                        setEditDestId(d.id);
                        setNdType(d.type);
                        setNdName(d.name);
                        const prefill: Record<string, string> = {};
                        if (d.type === "ftp") {
                          if (d.config.host) prefill.host = d.config.host;
                          prefill.port = String(d.config.port ?? 21);
                          prefill.secure = d.config.secure ? "true" : "false";
                        } else if (d.type === "s3") {
                          if (d.config.bucket) prefill.bucket = d.config.bucket;
                          if (d.config.region) prefill.region = d.config.region;
                          if (d.config.endpoint) prefill.endpoint = d.config.endpoint;
                          if (d.config.accessKeyId) prefill.accessKeyId = d.config.accessKeyId;
                        } else {
                          if (d.config.clientId) prefill.clientId = d.config.clientId;
                        }
                        setNdCfg(prefill);
                        setShowDestForm(true);
                      }} className="font-medium text-slate-500 hover:underline dark:text-slate-400">{t("dbp.edit")}</button>
                      <button onClick={() => confirm(`${t("dbp.confirmDelDest")} "${d.name}"? ${t("dbp.confirmDelDest2")}`) && api(`/api/db/destinations/${d.id}`, "DELETE")} className="font-medium text-red-500 hover:underline">{t("dbp.delete")}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Clone modal */}
      {cloneConnId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("dbp.cloneTitle")}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("dbp.cloneDesc")}</p>
            <select value={cloneTeamId} onChange={(e) => setCloneTeamId(e.target.value)} className={`${input} mt-4 w-full`}>
              <option value="">{t("dbp.phPickTeam")}</option>
              {teams.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setCloneConnId(null); setCloneTeamId(""); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">{t("dbp.cancel")}</button>
              <button
                disabled={!cloneTeamId || busy}
                onClick={async () => {
                  setBusy(true);
                  const res = await fetch(`/api/db/connections/${cloneConnId}/clone`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId: cloneTeamId }) });
                  const d = await res.json().catch(() => ({}));
                  setBusy(false);
                  if (!res.ok || d.ok === false) setMsg({ text: d.message ?? t("dbp.cloneFailed"), ok: false });
                  else { setMsg({ text: `${t("dbp.cloneOk")} + ${d.data?.jobCount ?? 0} ${t("dbp.unitJob")}.`, ok: true }); setCloneConnId(null); setCloneTeamId(""); load(); }
                }}
                className={btnPrimary}
              >{busy ? "…" : t("dbp.clone")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Restore modal */}
      {restoreRunId && restoreOrigJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("dbp.restoreTitle")}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("dbp.restoreDesc")}</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className={label}>{t("dbp.destConnsTitle")}</label>
                <select value={restoreConnId} onChange={(e) => loadRestoreDatabases(e.target.value)} className={`${input} mt-1 w-full`}>
                  {conns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.host}){c.id === restoreOrigJob.connId ? ` — ${t("dbp.orig")}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={label}>{t("dbp.restoreDbLabel")}</label>
                {restoreDbList === null ? (
                  <p className="mt-2 text-xs text-slate-400">{t("dbp.loadingDbs")}</p>
                ) : restoreDbList.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-400">{t("dbp.noDbsAvailable")}</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {restoreDbList.map((db) => {
                      const on = restoreDbs.has(db);
                      const fromBackup = restoreOrigJob.databases.includes(db);
                      return (
                        <button type="button" key={db} onClick={() => setRestoreDbs((s) => { const n = new Set(s); if (on) n.delete(db); else n.add(db); return n; })}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${on ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
                        >{on ? "✓ " : ""}{db}{fromBackup && !on ? ` (${t("dbp.orig")})` : ""}</button>
                      );
                    })}
                  </div>
                )}
              </div>

              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {t("dbp.restoreAutoCreate")}
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => { setRestoreRunId(null); setRestoreOrigJob(null); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">{t("dbp.cancel")}</button>
              <button disabled={busy || restoreDbs.size === 0} onClick={doRestore} className={btnPrimary}>
                {busy ? t("dbp.restoreBusy") : t("dbp.restoreNow")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TAB: JOB BACKUP ===== */}
      {tab === "job" && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("dbp.tabJob")}</h2>
            <button onClick={() => { setShowJobForm(!showJobForm); setEditJobId(null); setJName(""); setJDbs(new Set()); setJDestPath(""); setJDestId(""); setJRetention(0); setJCompression("brotli"); }} disabled={conns.length === 0} className={btnPrimary}>
              {showJobForm ? t("dbp.closeForm") : t("dbp.addJob")}
            </button>
          </div>

          {showJobForm && (
            <form onSubmit={createJob} className={`${card} animate-fade-up mb-4 space-y-5`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editJobId ? t("dbp.editJob") : t("dbp.createJob")}</h3>
                <button type="button" onClick={() => { setShowJobForm(false); setEditJobId(null); }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">{t("dbp.close")}</button>
              </div>

              <div className="flex flex-wrap gap-4">
                <div><label className={label}>{t("dbp.jobName")}</label><input required value={jName} onChange={(e) => setJName(e.target.value)} placeholder={t("dbp.phJobName")} className={`${input} mt-1 w-56`} /></div>
                <div>
                  <label className={label}>{t("dbp.connLabel")}</label>
                  <select required value={jConn} onChange={(e) => loadDatabases(e.target.value)} className={`${input} mt-1 w-56`}>
                    <option value="">{t("dbp.phPickConn")}</option>
                    {conns.map((c) => (<option key={c.id} value={c.id}>{c.name} ({c.host})</option>))}
                  </select>
                </div>
              </div>

              {jConn && (
                <div>
                  <label className={label}>{t("dbp.dbsToBackup")}</label>
                  {dbList === null ? (
                    <p className="mt-2 text-xs text-slate-400">{t("dbp.loadingDbs")}</p>
                  ) : dbList.length === 0 ? (
                    <p className="mt-2 text-xs text-red-500">{t("dbp.noDbsFail")}</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {dbList.map((db) => {
                        const on = jDbs.has(db);
                        return (
                          <button type="button" key={db} onClick={() => setJDbs((s) => { const n = new Set(s); if (on) n.delete(db); else n.add(db); return n; })}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${on ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
                          >{on ? "✓ " : ""}{db}</button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className={label}>{t("dbp.scheduleLabel")}</label>
                  <select value={jType} onChange={(e) => setJType(e.target.value)} className={`${input} mt-1`}>
                    <option value="hourly">{t("dbp.optHourly")}</option>
                    <option value="daily">{t("dbp.optDaily")}</option>
                    <option value="weekly">{t("dbp.optWeekly")}</option>
                    <option value="monthly">{t("dbp.optMonthly")}</option>
                    <option value="cron">{t("dbp.optCron")}</option>
                  </select>
                </div>
                {jType === "weekly" && (
                  <div><label className={label}>{t("dbp.dayLabel")}</label><select value={jDay} onChange={(e) => setJDay(Number(e.target.value))} className={`${input} mt-1`}>{DAY_NAMES.map((d, i) => (<option key={i} value={i}>{t(d)}</option>))}</select></div>
                )}
                {jType === "monthly" && (
                  <div><label className={label}>{t("dbp.dateLabel")}</label><select value={jDate} onChange={(e) => setJDate(Number(e.target.value))} className={`${input} mt-1`}>{Array.from({ length: 28 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}</option>))}</select></div>
                )}
                {jType !== "cron" && jType !== "hourly" ? (
                  <div><label className={label}>{t("dbp.timeLabel")}</label><div className="mt-1"><TimeField value={jTime} onChange={setJTime} /></div></div>
                ) : jType === "cron" ? (
                  <div><label className={label}>{t("dbp.cronHelp")}</label><input value={jCron} onChange={(e) => setJCron(e.target.value)} placeholder="0 2 * * *" className={`${input} mt-1 w-40 font-mono`} /></div>
                ) : null}
              </div>

              <div>
                <label className={label}>{t("dbp.backupDestLabel")}</label>
                <div className="mt-2 flex gap-2">
                  {[{ v: "local", l: t("dbp.destLocal") }, { v: "ftp", l: "🌐 FTP" }, { v: "s3", l: "☁️ S3" }, { v: "gdrive", l: "📂 Google Drive" }].map((o) => (
                    <button type="button" key={o.v} onClick={() => { setJDest(o.v); setJDestId(""); setJDestPath(""); }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${jDest === o.v ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
                    >{o.l}</button>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  {jDest === "local" && (
                    <div className="w-full"><label className={label}>{t("dbp.destPathLabel")}</label><input required value={jDestPath} onChange={(e) => setJDestPath(e.target.value)} placeholder={t("dbp.phDestPath")} className={`${input} mt-1 w-full max-w-lg`} /></div>
                  )}
                  {jDest !== "local" && (
                    <>
                      <div className="w-full">
                        <label className={label}>{t("dbp.destConnSelLabel")}</label>
                        <select required value={jDestId} onChange={(e) => setJDestId(e.target.value)} className={`${input} mt-1 w-72`}>
                          <option value="">{t("dbp.phPickDest")}</option>
                          {dests.filter((d) => d.type === jDest).map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
                        </select>
                        {dests.filter((d) => d.type === jDest).length === 0 && (
                          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{t("dbp.noDestHint1")} {jDest === "gdrive" ? t("dbp.gdriveName") : jDest.toUpperCase()}. {t("dbp.noDestHint2")}</p>
                        )}
                      </div>
                      {jDest === "gdrive" ? (
                        <div><label className={label}>{t("dbp.folderIdOpt")}</label><input value={jDestPath} onChange={(e) => setJDestPath(e.target.value)} placeholder={t("dbp.phFolderId")} className={`${input} mt-1 w-64`} /></div>
                      ) : jDest === "ftp" ? (
                        <div><label className={label}>{t("dbp.destFolderLabel")}</label><input value={jDestPath} onChange={(e) => setJDestPath(e.target.value)} placeholder="/backups" className={`${input} mt-1 w-40`} /></div>
                      ) : (
                        <div><label className={label}>{t("dbp.folderPrefix")}</label><input value={jDestPath} onChange={(e) => setJDestPath(e.target.value)} placeholder="mysql/" className={`${input} mt-1 w-32`} /></div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div>
                <label className={label}>{t("dbp.retentionLabel")}</label>
                <div className="mt-2 flex items-center gap-3">
                  <input type="number" min={0} max={1000} value={jRetention} onChange={(e) => setJRetention(Number(e.target.value) || 0)} className={`${input} w-24`} />
                  <span className="text-xs text-slate-500 dark:text-slate-400">{jRetention === 0 ? t("dbp.keepAll") : `${t("dbp.keepPrefix")} ${jRetention} ${t("dbp.keepLast")}`}</span>
                </div>
              </div>

              <div>
                <label className={label}>{t("dbp.compressionLabel")}</label>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {(["none", "gzip", "brotli", "xz", "xz_extreme"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setJCompression(c)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${jCompression === c ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900" : "border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"}`}
                    >
                      {c === "none" ? t("dbp.compNone") : c === "gzip" ? "Gzip" : c === "brotli" ? "Brotli" : c === "xz" ? "7z" : t("dbp.comp7zExt")}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  {jCompression === "none" && t("dbp.compNoneDesc")}
                  {jCompression === "gzip" && t("dbp.compGzipDesc")}
                  {jCompression === "brotli" && t("dbp.compBrotliDesc")}
                  {jCompression === "xz" && t("dbp.compXzDesc")}
                  {jCompression === "xz_extreme" && t("dbp.compXzExtDesc")}
                </p>
              </div>

              <div className="flex justify-end">
                <button disabled={busy || jDbs.size === 0} className={btnPrimary}>
                  {busy ? t("dbp.saving") : editJobId ? `${t("dbp.updateJob")} (${jDbs.size} ${t("dbp.dbUnit")})` : `${t("dbp.saveJob")} (${jDbs.size} ${t("dbp.dbUnit")})`}
                </button>
              </div>
            </form>
          )}

          {/* Fixed two-column: 1/3 list + 2/3 detail — no layout shift */}
          {loading ? null : jobs.length === 0 ? (
            <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
              {t("dbp.noJobs")}
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Left column: job list (1/3 on desktop) */}
              <div className="space-y-2 lg:col-span-1">
                {jobs.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => selectJob(j.id)}
                    className={`w-full text-left rounded-xl border p-4 transition ${selectedJobId === j.id ? "border-slate-900 bg-slate-50 dark:border-slate-300 dark:bg-slate-800" : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{j.name}</p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {j.lastStatus && (
                          <span className={`h-2 w-2 rounded-full ${j.lastStatus === "success" ? "bg-emerald-500" : j.lastStatus === "running" ? "animate-pulse bg-sky-500" : "bg-red-500"}`} />
                        )}
                        {!j.enabled && <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />}
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                      {j.connection.name} · {j.databases.length} db · {scheduleLabel(j)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                      → {destLabel(j)}{j.retention > 0 ? ` · ${t("dbp.retentionShort")} ${j.retention}` : ""}{j.compression ? ` · ${j.compression === "none" ? t("dbp.compNoneSmall") : j.compression === "gzip" ? "gzip" : j.compression === "brotli" ? "brotli" : j.compression === "xz" ? "7z" : t("dbp.comp7zExtSmall")}` : ""}
                    </p>
                  </button>
                ))}
              </div>

              {/* Right column: detail panel (2/3 on desktop) */}
              <div className="lg:col-span-2">
                {selected ? (
                  <div className={`${card} lg:sticky lg:top-4`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">{selected.name}</h3>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {selected.connection.name} ({selected.connection.host}) · {selected.databases.join(", ")}
                        </p>
                      </div>
                      <button onClick={() => setSelectedJobId(null)} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 lg:hidden">✕</button>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{scheduleLabel(selected)}</span>
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">→ {destLabel(selected)}</span>
                      {selected.retention > 0 && <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t("dbp.retentionShort")} {selected.retention}</span>}
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{selected.compression === "none" ? t("dbp.compNoneSmall") : selected.compression === "gzip" ? "gzip" : selected.compression === "brotli" ? "brotli" : selected.compression === "xz" ? "7z" : t("dbp.comp7zExtSmall")}</span>
                      {selected.lastStatus && (
                        <span className={`rounded-lg px-2.5 py-1 font-semibold ${selected.lastStatus === "success" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : selected.lastStatus === "running" ? "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-400" : "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400"}`}>
                          {selected.lastStatus === "running" ? t("dbp.running") : selected.lastStatus}
                        </span>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={() => api(`/api/db/jobs/${selected.id}/run`, "POST")} disabled={busy || selected.lastStatus === "running"} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50">{t("dbp.runNow")}</button>
                      {selected.lastStatus === "running" && (
                        <button onClick={() => confirm(t("dbp.confirmReset")) && api(`/api/db/jobs/${selected.id}/reset`, "POST").then(() => load())} disabled={busy} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-50">{t("dbp.reset")}</button>
                      )}
                      <button onClick={() => api(`/api/db/jobs/${selected.id}`, "PATCH", { enabled: !selected.enabled })} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                        {selected.enabled ? t("dbp.disable") : t("dbp.enable")}
                      </button>
                      <button onClick={() => { openEdit(selected); }} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">{t("dbp.edit")}</button>
                      <button onClick={() => confirm(`${t("dbp.confirmDelJob")} "${selected.name}"?`) && api(`/api/db/jobs/${selected.id}`, "DELETE")} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40">{t("dbp.delete")}</button>
                    </div>

                    {/* Riwayat backup */}
                    <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("dbp.historyTitle")}</h4>
                      {runLoading && runs.length === 0 ? (
                        <p className="mt-3 text-xs text-slate-400">{t("dbp.loadingHistory")}</p>
                      ) : runs.length === 0 ? (
                        <p className="mt-3 text-xs text-slate-400">{t("dbp.noHistory")}</p>
                      ) : (
                        <>
                          <div className="mt-3 space-y-2">
                            {runs.map((r) => {
                              const runOk = r.status === "success";
                              return (
                                <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-100 px-3 py-2 text-[11px] dark:border-slate-800">
                                  <span className={r.status === "success" ? "text-emerald-600" : r.status === "running" ? "text-sky-600" : "text-red-500"}>
                                    {r.status === "success" ? "✓" : r.status === "running" ? "⟳" : "✕"} {r.status}
                                  </span>
                                  <span className="text-slate-500 dark:text-slate-400">{new Date(r.startedAt).toLocaleString("id-ID")}</span>
                                  <span className="text-slate-500 dark:text-slate-400">{fmtSize(r.sizeBytes)}{r.sqlSizeBytes != null && r.sqlSizeBytes !== r.sizeBytes ? <> · <span className="text-slate-400 dark:text-slate-500">SQL {fmtSize(r.sqlSizeBytes)}</span></> : ""}</span>
                                  {fmtDuration(r.startedAt, r.endedAt) && <span className="text-slate-400 dark:text-slate-500">⏱ {fmtDuration(r.startedAt, r.endedAt)}</span>}
                                  {r.location && <span className="max-w-[200px] truncate font-mono text-slate-400">{r.location}</span>}
                                  {r.message && r.status === "failed" && <span className="text-red-500">{r.message}</span>}
                                  <span className="ml-auto flex items-center gap-2">
                                    {runOk && <a href={`/api/db/runs/${r.id}/download`} className="text-sky-600 hover:underline dark:text-sky-400">{t("dbp.download")}</a>}
                                    {runOk && <a href={`/api/db/runs/${r.id}/download?format=sql`} className="text-sky-600 hover:underline dark:text-sky-400">{t("dbp.downloadSql")}</a>}
                                    {runOk && <button onClick={() => openRestoreModal(r.id, { connection: { id: selected.connection.id, name: selected.connection.name }, databases: selected.databases })} disabled={busy} className="text-amber-600 hover:underline disabled:opacity-50 dark:text-amber-400">{t("dbp.restoreBtn")}</button>}
                                    <button onClick={() => { if (confirm(t("dbp.confirmDelRun"))) { api(`/api/db/runs/${r.id}`, "DELETE").then(() => refreshRuns()); } }} disabled={busy} className="text-red-500 hover:underline disabled:opacity-50">{t("dbp.delete")}</button>
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          {runTotalPages > 1 && (
                            <div className="mt-3 flex items-center justify-center gap-2">
                              <button onClick={() => { if (runPage > 1) { setRunLoading(true); loadRuns(selected.id, runPage - 1); } }} disabled={runPage <= 1 || runLoading} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">{t("dbp.prev")}</button>
                              <span className="text-xs text-slate-500 dark:text-slate-400">{runPage} / {runTotalPages}</span>
                              <button onClick={() => { if (runPage < runTotalPages) { setRunLoading(true); loadRuns(selected.id, runPage + 1); } }} disabled={runPage >= runTotalPages || runLoading} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">{t("dbp.next")}</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="hidden flex-1 items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/30 p-12 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/20 lg:flex">
                    {t("dbp.selectJobHint")}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
