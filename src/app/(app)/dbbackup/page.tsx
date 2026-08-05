"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TimeField from "@/components/TimeField";

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

const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

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
  if (!endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (isNaN(ms) || ms < 0) return null;
  const totalSecs = Math.round(ms / 1000);
  if (totalSecs < 60) return `${totalSecs} dtk`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins < 60) return secs ? `${mins} mnt ${secs} dtk` : `${mins} mnt`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins ? `${hours} jam ${remMins} mnt` : `${hours} jam`;
}

function scheduleLabel(j: Job): string {
  if (j.scheduleType === "hourly") return "Perjam";
  if (j.scheduleType === "daily") return `Harian ${j.timeAt}`;
  if (j.scheduleType === "weekly") return `Mingguan, ${DAY_NAMES[j.dayOn ?? 0]} ${j.timeAt}`;
  if (j.scheduleType === "monthly") return `Bulanan, tgl ${j.dayOn} ${j.timeAt}`;
  return `Cron: ${j.cronExpr}`;
}

function destLabel(j: Job): string {
  if (j.destType === "local") return `📁 ${j.destPath}`;
  if (j.destType === "gdrive") return `📂 ${j.dest?.name ?? "Google Drive"}`;
  if (j.destType === "ftp") return `🌐 ${j.dest?.name ?? "FTP"}`;
  return `☁️ ${j.dest?.name ?? "S3"}`;
}

export default function DbBackupPage() {
  const router = useRouter();
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
      setMsg({ text: `✅ Google Drive terkoneksi sebagai ${ok}`, ok: true });
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
      setMsg({ text: d.message ?? "Terjadi kesalahan", ok: false });
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
      setMsg({ text: d.message ?? "Gagal mengambil daftar database", ok: false });
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
    const d = await res.json().catch(() => ({ message: `HTTP ${res.status} — tidak ada response dari server` }));
    setRestoreRunId(null);

    if (!res.ok || d.ok === false) {
      setBusy(false);
      setMsg({ text: d.message ?? "Gagal memulai restore", ok: false });
      return;
    }

    // Async restore started — poll for status
    const restoreId = d.data?.restoreId;
    setRestoreProgress({ pct: 0, text: "Memulai restore…" });

    const poll = async () => {
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const pRes = await fetch(`/api/db/restores/${restoreId}`);
        const p = await pRes.json().catch(() => null);
        if (!p?.ok) continue;
        if (p.data.status === "success") {
          setBusy(false);
          setRestoreProgress(null);
          const warnText = p.data.warnings?.length ? ` (${p.data.warnings.length} peringatan)` : "";
          setMsg({ text: `✓ Restore selesai${warnText}`, ok: true });
          load();
          refreshRuns();
          return;
        }
        if (p.data.status === "failed") {
          setBusy(false);
          setRestoreProgress(null);
          setMsg({ text: `Gagal restore: ${p.data.message}`, ok: false });
          return;
        }
        // Update progress
        if (p.data.progressPct != null && p.data.progressText) {
          setRestoreProgress({ pct: p.data.progressPct, text: p.data.progressText });
        }
      }
      setBusy(false);
      setRestoreProgress(null);
      setMsg({ text: "Restore masih berjalan. Cek log server untuk detail.", ok: true });
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
      setMsg({ text: editJobId ? "Job backup diperbarui." : "Job backup dibuat.", ok: true });
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
    return <p className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">Halaman ini hanya untuk admin.</p>;
  }

  const ND = (k: string) => ndCfg[k] ?? "";
  const setND = (k: string, v: string) => setNdCfg((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Backup Database</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Backup MySQL terjadwal ke lokal, FTP, S3, atau Google Drive.
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800 w-fit">
        <button
          onClick={() => setTab("sumber")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "sumber" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
        >
          Sumber
        </button>
        <button
          onClick={() => setTab("tujuan")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "tujuan" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
        >
          Tujuan
        </button>
        <button
          onClick={() => setTab("job")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "job" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
        >
          Job Backup
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
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Koneksi Sumber</h2>
            <button onClick={() => { setShowConnForm(!showConnForm); setEditConnId(null); setNc({ name: "", host: "", port: "3306", username: "", password: "", useSsh: false, sshId: "" }); }} className={btnPrimary}>
              {showConnForm ? "Tutup form" : "+ Tambah koneksi"}
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
                    setMsg({ text: "Koneksi diperbarui.", ok: true });
                  }
                } else {
                  const ok = await api("/api/db/connections", "POST", payload);
                  if (ok) {
                    setShowConnForm(false);
                    setNc({ name: "", host: "", port: "3306", username: "", password: "", useSsh: false, sshId: "" });
                    setMsg({ text: "Koneksi tersimpan (tes koneksi berhasil).", ok: true });
                  }
                }
              }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editConnId ? "Edit Koneksi" : "Buat Koneksi"}</h3>
                <button type="button" onClick={() => { setShowConnForm(false); setEditConnId(null); }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">✕ Tutup</button>
              </div>

              {/* RDBMS selector */}
              <div>
                <label className={label}>Tipe Database</label>
                <div className="mt-2 flex gap-2">
                  {[{ v: "mysql", l: "🐬 MySQL", active: true }, { v: "postgresql", l: "🐘 PostgreSQL", active: false }, { v: "sqlite", l: "🪶 SQLite", active: false }].map((o) => (
                    <button type="button" key={o.v} disabled={!o.active}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${o.active ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600"}`}
                    >{o.l}{!o.active && " (coming soon)"}</button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <div><label className={label}>Nama</label><input required value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} placeholder="mis. DB Produksi" className={`${input} mt-1 w-56`} /></div>
                <div><label className={label}>Host</label><input required value={nc.host} onChange={(e) => setNc({ ...nc, host: e.target.value })} placeholder="103.x.x.x" className={`${input} mt-1 w-56`} /></div>
                <div><label className={label}>Port</label><input value={nc.port} onChange={(e) => setNc({ ...nc, port: e.target.value })} className={`${input} mt-1 w-24`} /></div>
                <div><label className={label}>Username</label><input required value={nc.username} onChange={(e) => setNc({ ...nc, username: e.target.value })} className={`${input} mt-1 w-44`} /></div>
                <div><label className={label}>Password</label><input type="password" value={nc.password} onChange={(e) => setNc({ ...nc, password: e.target.value })} placeholder={editConnId ? "Kosongkan jika tidak diubah" : ""} className={`${input} mt-1 w-44`} /></div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                <label className={label}>SSH Koneksi</label>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setNc({ ...nc, useSsh: !nc.useSsh })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${nc.useSsh ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600"}`}
                  >
                    {nc.useSsh ? "✓ Pakai SSH" : "Tanpa SSH"}
                  </button>
                  {nc.useSsh && (
                    <select value={nc.sshId} onChange={(e) => setNc({ ...nc, sshId: e.target.value })} required className={`${input} w-72`}>
                      <option value="">— pilih koneksi SSH —</option>
                      {sshs.map((s) => (<option key={s.id} value={s.id}>{s.name} ({s.username}@{s.host}:{s.port})</option>))}
                    </select>
                  )}
                </div>
                {nc.useSsh && sshs.length === 0 && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Belum ada koneksi SSH. Tambahkan dulu lewat menu &ldquo;SSH Koneksi&rdquo;.</p>
                )}
                {nc.useSsh && (
                  <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">Koneksi MySQL akan diakses lewat tunnel SSH ini (host MySQL di bawah dianggap host dalam server SSH).</p>
                )}
              </div>

              <div className="flex justify-end">
                <button disabled={busy} className={btnPrimary}>{busy ? "…" : editConnId ? "Simpan edit" : "Tes & simpan"}</button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          ) : conns.length === 0 ? (
            <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
              Belum ada koneksi. Tambahkan koneksi database untuk memulai.
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
                    <p className="truncate text-xs text-slate-400">{c.username}@{c.host}:{c.port}{c.ssh ? ` · via SSH ${c.ssh.name}` : ""} · {c.jobCount} job</p>
                  </div>
                  <div className="flex shrink-0 gap-2 text-xs">
                    <button onClick={() => { setEditConnId(c.id); setNc({ name: c.name, host: c.host, port: String(c.port), username: c.username, password: "", useSsh: !!c.sshId, sshId: c.sshId ?? "" }); setShowConnForm(true); }} className="font-medium text-slate-500 hover:underline dark:text-slate-400">Edit</button>
                    <button onClick={() => { setCloneConnId(c.id); setCloneTeamId(""); }} className="font-medium text-sky-600 hover:underline dark:text-sky-400">Clone</button>
                    <button onClick={() => confirm(`Hapus koneksi "${c.name}" beserta job backup-nya?`) && api(`/api/db/connections/${c.id}`, "DELETE")} className="font-medium text-red-500 hover:underline">Hapus</button>
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
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Koneksi Tujuan</h2>
            <button onClick={() => { setShowDestForm(!showDestForm); setEditDestId(null); setNdName(""); setNdCfg({}); setNdType("gdrive"); }} className={btnPrimary}>
              {showDestForm ? "Tutup form" : "+ Tambah tujuan"}
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
                  setMsg({ text: editDestId ? "Koneksi tujuan diperbarui." : "Koneksi tujuan tersimpan.", ok: true });
                }
              }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editDestId ? "Edit Koneksi Tujuan" : "Buat Koneksi Tujuan"}</h3>
                <button type="button" onClick={() => { setShowDestForm(false); setEditDestId(null); }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">✕ Tutup</button>
              </div>

              <div>
                <label className={label}>Tipe tujuan</label>
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
                <div><label className={label}>Nama</label><input required value={ndName} onChange={(e) => setNdName(e.target.value)} placeholder="mis. FTP Server A" className={`${input} mt-1 w-56`} /></div>
                {ndType === "ftp" && (
                  <>
                    <div><label className={label}>Host</label><input required value={ND("host")} onChange={(e) => setND("host", e.target.value)} placeholder="ftp.example.com" className={`${input} mt-1 w-52`} /></div>
                    <div><label className={label}>Port</label><input value={ND("port") || "21"} onChange={(e) => setND("port", e.target.value)} className={`${input} mt-1 w-20`} /></div>
                    <div><label className={label}>Username</label><input required value={ND("username")} onChange={(e) => setND("username", e.target.value)} className={`${input} mt-1 w-40`} /></div>
                    <div><label className={label}>Password</label><input type="password" required={!editDestId} value={ND("password")} onChange={(e) => setND("password", e.target.value)} placeholder={editDestId ? "Kosongkan jika tidak diubah" : ""} className={`${input} mt-1 w-40`} /></div>
                    <div className="flex items-center gap-2 pt-6">
                      <input id="ftp-secure" type="checkbox" checked={ND("secure") === "true"} onChange={(e) => setND("secure", e.target.checked ? "true" : "false")} className="h-4 w-4 accent-slate-900" />
                      <label htmlFor="ftp-secure" className="text-xs text-slate-500 dark:text-slate-400">FTPS (Secure)</label>
                    </div>
                  </>
                )}
                {ndType === "s3" && (
                  <>
                    <div><label className={label}>Bucket</label><input required value={ND("bucket")} onChange={(e) => setND("bucket", e.target.value)} className={`${input} mt-1 w-40`} /></div>
                    <div><label className={label}>Region</label><input value={ND("region")} onChange={(e) => setND("region", e.target.value)} placeholder="ap-southeast-1" className={`${input} mt-1 w-36`} /></div>
                    <div><label className={label}>Endpoint (opsional)</label><input value={ND("endpoint")} onChange={(e) => setND("endpoint", e.target.value)} placeholder="https://…" className={`${input} mt-1 w-56`} /></div>
                    <div><label className={label}>Access key</label><input required value={ND("accessKeyId")} onChange={(e) => setND("accessKeyId", e.target.value)} className={`${input} mt-1 w-44`} /></div>
                    <div><label className={label}>Secret key</label><input required={!editDestId} type="password" value={ND("secretKey")} onChange={(e) => setND("secretKey", e.target.value)} placeholder={editDestId ? "Kosongkan jika tidak diubah" : ""} className={`${input} mt-1 w-44`} /></div>
                  </>
                )}
                {ndType === "gdrive" && (
                  <>
                    <div className="w-full">
                      <label className={label}>Google OAuth Client ID</label>
                      <input required value={ND("clientId")} onChange={(e) => setND("clientId", e.target.value)} placeholder="xxxx.apps.googleusercontent.com" className={`${input} mt-1 w-80`} />
                      <p className="mt-1 text-[11px] text-slate-400">Redirect URI: <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">{typeof window !== "undefined" ? window.location.origin : ""}/api/db/gdrive/callback</code></p>
                    </div>
                    <div className="w-full">
                      <label className={label}>Google OAuth Client Secret</label>
                      <input type="password" required={!editDestId} value={ND("clientSecret")} onChange={(e) => setND("clientSecret", e.target.value)} placeholder={editDestId ? "Kosongkan jika tidak diubah" : "GOCSPX-..."} className={`${input} mt-1 w-80`} />
                    </div>
                  </>
                )}
              </div>

              <div className="flex justify-end">
                <button disabled={busy} className={btnPrimary}>{busy ? "…" : editDestId ? "Simpan edit" : "Simpan tujuan"}</button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          ) : dests.length === 0 ? (
            <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
              Belum ada koneksi tujuan. Tambahkan koneksi FTP, S3, atau Google Drive di sini.
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
                        {d.type === "gdrive" && (connected ? `✅ Terkoneksi sebagai ${d.config.gdriveUserEmail}` : "Belum login Google")}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{d.jobCount} job menggunakan</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {d.type === "gdrive" && (
                        <a href={`/api/db/gdrive/auth?destId=${d.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white transition hover:bg-blue-500">
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#fff"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" opacity=".8"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" opacity=".6"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" opacity=".9"/></svg>
                          {connected ? "Login ulang" : "Login Google"}
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
                      }} className="font-medium text-slate-500 hover:underline dark:text-slate-400">Edit</button>
                      <button onClick={() => confirm(`Hapus koneksi tujuan "${d.name}"? Job yang memakainya akan kehilangan tujuan.`) && api(`/api/db/destinations/${d.id}`, "DELETE")} className="font-medium text-red-500 hover:underline">Hapus</button>
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
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Clone Koneksi ke Tim Lain</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Koneksi dan semua job-nya akan disalin ke tim tujuan.</p>
            <select value={cloneTeamId} onChange={(e) => setCloneTeamId(e.target.value)} className={`${input} mt-4 w-full`}>
              <option value="">— pilih tim tujuan —</option>
              {teams.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setCloneConnId(null); setCloneTeamId(""); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Batal</button>
              <button
                disabled={!cloneTeamId || busy}
                onClick={async () => {
                  setBusy(true);
                  const res = await fetch(`/api/db/connections/${cloneConnId}/clone`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId: cloneTeamId }) });
                  const d = await res.json().catch(() => ({}));
                  setBusy(false);
                  if (!res.ok || d.ok === false) setMsg({ text: d.message ?? "Gagal clone", ok: false });
                  else { setMsg({ text: `Berhasil clone + ${d.data?.jobCount ?? 0} job.`, ok: true }); setCloneConnId(null); setCloneTeamId(""); load(); }
                }}
                className={btnPrimary}
              >{busy ? "…" : "Clone"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Restore modal */}
      {restoreRunId && restoreOrigJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Restore Backup</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Pilih koneksi tujuan untuk restore. Default ke koneksi asal backup.</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className={label}>Koneksi Tujuan</label>
                <select value={restoreConnId} onChange={(e) => loadRestoreDatabases(e.target.value)} className={`${input} mt-1 w-full`}>
                  {conns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.host}){c.id === restoreOrigJob.connId ? " — asal" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={label}>Database dari file backup</label>
                {restoreDbList === null ? (
                  <p className="mt-2 text-xs text-slate-400">Mengambil daftar database…</p>
                ) : restoreDbList.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-400">Tidak ada database tersedia.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {restoreDbList.map((db) => {
                      const on = restoreDbs.has(db);
                      const fromBackup = restoreOrigJob.databases.includes(db);
                      return (
                        <button type="button" key={db} onClick={() => setRestoreDbs((s) => { const n = new Set(s); if (on) n.delete(db); else n.add(db); return n; })}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${on ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
                        >{on ? "✓ " : ""}{db}{fromBackup && !on ? " (asal)" : ""}</button>
                      );
                    })}
                  </div>
                )}
              </div>

              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Database dari file backup akan dibuat otomatis jika belum ada di server tujuan.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => { setRestoreRunId(null); setRestoreOrigJob(null); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Batal</button>
              <button disabled={busy || restoreDbs.size === 0} onClick={doRestore} className={btnPrimary}>
                {busy ? "Restore…" : "Restore sekarang"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TAB: JOB BACKUP ===== */}
      {tab === "job" && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Job Backup</h2>
            <button onClick={() => { setShowJobForm(!showJobForm); setEditJobId(null); setJName(""); setJDbs(new Set()); setJDestPath(""); setJDestId(""); setJRetention(0); setJCompression("brotli"); }} disabled={conns.length === 0} className={btnPrimary}>
              {showJobForm ? "Tutup form" : "+ Buat job"}
            </button>
          </div>

          {showJobForm && (
            <form onSubmit={createJob} className={`${card} animate-fade-up mb-4 space-y-5`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editJobId ? "Edit Job Backup" : "Buat Job Backup"}</h3>
                <button type="button" onClick={() => { setShowJobForm(false); setEditJobId(null); }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">✕ Tutup</button>
              </div>

              <div className="flex flex-wrap gap-4">
                <div><label className={label}>Nama job</label><input required value={jName} onChange={(e) => setJName(e.target.value)} placeholder="mis. backup-harian-app" className={`${input} mt-1 w-56`} /></div>
                <div>
                  <label className={label}>Koneksi</label>
                  <select required value={jConn} onChange={(e) => loadDatabases(e.target.value)} className={`${input} mt-1 w-56`}>
                    <option value="">— pilih koneksi —</option>
                    {conns.map((c) => (<option key={c.id} value={c.id}>{c.name} ({c.host})</option>))}
                  </select>
                </div>
              </div>

              {jConn && (
                <div>
                  <label className={label}>Database yang di-backup</label>
                  {dbList === null ? (
                    <p className="mt-2 text-xs text-slate-400">Mengambil daftar database…</p>
                  ) : dbList.length === 0 ? (
                    <p className="mt-2 text-xs text-red-500">Tidak ada database / gagal terhubung.</p>
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
                  <label className={label}>Jadwal</label>
                  <select value={jType} onChange={(e) => setJType(e.target.value)} className={`${input} mt-1`}>
                    <option value="hourly">Perjam</option>
                    <option value="daily">Harian</option>
                    <option value="weekly">Mingguan</option>
                    <option value="monthly">Bulanan</option>
                    <option value="cron">Cron expression</option>
                  </select>
                </div>
                {jType === "weekly" && (
                  <div><label className={label}>Hari</label><select value={jDay} onChange={(e) => setJDay(Number(e.target.value))} className={`${input} mt-1`}>{DAY_NAMES.map((d, i) => (<option key={i} value={i}>{d}</option>))}</select></div>
                )}
                {jType === "monthly" && (
                  <div><label className={label}>Tanggal</label><select value={jDate} onChange={(e) => setJDate(Number(e.target.value))} className={`${input} mt-1`}>{Array.from({ length: 28 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}</option>))}</select></div>
                )}
                {jType !== "cron" && jType !== "hourly" ? (
                  <div><label className={label}>Jam</label><div className="mt-1"><TimeField value={jTime} onChange={setJTime} /></div></div>
                ) : jType === "cron" ? (
                  <div><label className={label}>Cron (menit jam tgl bulan hari)</label><input value={jCron} onChange={(e) => setJCron(e.target.value)} placeholder="0 2 * * *" className={`${input} mt-1 w-40 font-mono`} /></div>
                ) : null}
              </div>

              <div>
                <label className={label}>Tujuan backup</label>
                <div className="mt-2 flex gap-2">
                  {[{ v: "local", l: "💾 Lokal / SMB-mount" }, { v: "ftp", l: "🌐 FTP" }, { v: "s3", l: "☁️ S3" }, { v: "gdrive", l: "📂 Google Drive" }].map((o) => (
                    <button type="button" key={o.v} onClick={() => { setJDest(o.v); setJDestId(""); setJDestPath(""); }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${jDest === o.v ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
                    >{o.l}</button>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  {jDest === "local" && (
                    <div className="w-full"><label className={label}>Path folder tujuan</label><input required value={jDestPath} onChange={(e) => setJDestPath(e.target.value)} placeholder="/home/user/backups atau /Volumes/NAS/backup" className={`${input} mt-1 w-full max-w-lg`} /></div>
                  )}
                  {jDest !== "local" && (
                    <>
                      <div className="w-full">
                        <label className={label}>Koneksi tujuan</label>
                        <select required value={jDestId} onChange={(e) => setJDestId(e.target.value)} className={`${input} mt-1 w-72`}>
                          <option value="">— pilih koneksi tujuan —</option>
                          {dests.filter((d) => d.type === jDest).map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
                        </select>
                        {dests.filter((d) => d.type === jDest).length === 0 && (
                          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">Belum ada koneksi tujuan {jDest === "gdrive" ? "Google Drive" : jDest.toUpperCase()}. Tambahkan dulu di tab &ldquo;Tujuan&rdquo;.</p>
                        )}
                      </div>
                      {jDest === "gdrive" ? (
                        <div><label className={label}>Folder ID (opsional)</label><input value={jDestPath} onChange={(e) => setJDestPath(e.target.value)} placeholder="Kosongkan = simpan di root My Drive" className={`${input} mt-1 w-64`} /></div>
                      ) : jDest === "ftp" ? (
                        <div><label className={label}>Folder tujuan</label><input value={jDestPath} onChange={(e) => setJDestPath(e.target.value)} placeholder="/backups" className={`${input} mt-1 w-40`} /></div>
                      ) : (
                        <div><label className={label}>Prefix folder</label><input value={jDestPath} onChange={(e) => setJDestPath(e.target.value)} placeholder="mysql/" className={`${input} mt-1 w-32`} /></div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div>
                <label className={label}>Retensi backup</label>
                <div className="mt-2 flex items-center gap-3">
                  <input type="number" min={0} max={1000} value={jRetention} onChange={(e) => setJRetention(Number(e.target.value) || 0)} className={`${input} w-24`} />
                  <span className="text-xs text-slate-500 dark:text-slate-400">{jRetention === 0 ? "Simpan semua" : `Simpan ${jRetention} backup terakhir`}</span>
                </div>
              </div>

              <div>
                <label className={label}>Kompresi backup</label>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {(["none", "gzip", "brotli", "xz", "xz_extreme"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setJCompression(c)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${jCompression === c ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900" : "border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"}`}
                    >
                      {c === "none" ? "Tanpa" : c === "gzip" ? "Gzip" : c === "brotli" ? "Brotli" : c === "xz" ? "7z" : "7z Ekstrim"}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  {jCompression === "none" && "Tanpa kompresi — ukuran file = ukuran data asli. Paling cepat, mudah dibuka."}
                  {jCompression === "gzip" && "Gzip — bisa langsung dibuka TablePlus/phpMyAdmin. Ukuran ±1.3× dari brotli."}
                  {jCompression === "brotli" && "Brotli — seimbang. Contoh DB 121MB → ±10.6MB. Butuh aplikasi pendukung untuk membuka."}
                  {jCompression === "xz" && "7z (standar) — lebih kecil dari brotli. Contoh DB 121MB → ±8.0MB. Butuh 7-Zip untuk membuka."}
                  {jCompression === "xz_extreme" && "7z (ekstrim) — paling kecil. Contoh DB 121MB → ±7.3MB. Kompresi sedikit lebih lama. Butuh 7-Zip untuk membuka."}
                </p>
              </div>

              <div className="flex justify-end">
                <button disabled={busy || jDbs.size === 0} className={btnPrimary}>
                  {busy ? "Menyimpan…" : editJobId ? `Perbarui job (${jDbs.size} database)` : `Simpan job (${jDbs.size} database)`}
                </button>
              </div>
            </form>
          )}

          {/* Fixed two-column: 1/3 list + 2/3 detail — no layout shift */}
          {loading ? null : jobs.length === 0 ? (
            <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
              Belum ada job backup. Tambahkan koneksi lalu buat job.
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
                      → {destLabel(j)}{j.retention > 0 ? ` · Retensi: ${j.retention}` : ""}{j.compression ? ` · ${j.compression === "none" ? "tanpa kompresi" : j.compression === "gzip" ? "gzip" : j.compression === "brotli" ? "brotli" : j.compression === "xz" ? "7z" : "7z ekstrim"}` : ""}
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
                      {selected.retention > 0 && <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">Retensi: {selected.retention}</span>}
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{selected.compression === "none" ? "tanpa kompresi" : selected.compression === "gzip" ? "gzip" : selected.compression === "brotli" ? "brotli" : selected.compression === "xz" ? "7z" : "7z ekstrim"}</span>
                      {selected.lastStatus && (
                        <span className={`rounded-lg px-2.5 py-1 font-semibold ${selected.lastStatus === "success" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : selected.lastStatus === "running" ? "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-400" : "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400"}`}>
                          {selected.lastStatus === "running" ? "berjalan…" : selected.lastStatus}
                        </span>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={() => api(`/api/db/jobs/${selected.id}/run`, "POST")} disabled={busy || selected.lastStatus === "running"} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50">▶ Jalankan</button>
                      {selected.lastStatus === "running" && (
                        <button onClick={() => confirm('Job masih berstatus "berjalan" padahal prosesnya mungkin sudah mati. Reset status ini?') && api(`/api/db/jobs/${selected.id}/reset`, "POST").then(() => load())} disabled={busy} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-50">⟲ Reset</button>
                      )}
                      <button onClick={() => api(`/api/db/jobs/${selected.id}`, "PATCH", { enabled: !selected.enabled })} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                        {selected.enabled ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                      <button onClick={() => { openEdit(selected); }} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Edit</button>
                      <button onClick={() => confirm(`Hapus job "${selected.name}"?`) && api(`/api/db/jobs/${selected.id}`, "DELETE")} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40">Hapus</button>
                    </div>

                    {/* Riwayat backup */}
                    <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Riwayat Backup</h4>
                      {runLoading && runs.length === 0 ? (
                        <p className="mt-3 text-xs text-slate-400">Memuat riwayat…</p>
                      ) : runs.length === 0 ? (
                        <p className="mt-3 text-xs text-slate-400">Belum ada riwayat backup.</p>
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
                                    {runOk && <a href={`/api/db/runs/${r.id}/download`} className="text-sky-600 hover:underline dark:text-sky-400">Unduh</a>}
                                    {runOk && <a href={`/api/db/runs/${r.id}/download?format=sql`} className="text-sky-600 hover:underline dark:text-sky-400">Unduh SQL</a>}
                                    {runOk && <button onClick={() => openRestoreModal(r.id, { connection: { id: selected.connection.id, name: selected.connection.name }, databases: selected.databases })} disabled={busy} className="text-amber-600 hover:underline disabled:opacity-50 dark:text-amber-400">Restore</button>}
                                    <button onClick={() => { if (confirm("Hapus catatan backup ini beserta filenya?")) { api(`/api/db/runs/${r.id}`, "DELETE").then(() => refreshRuns()); } }} disabled={busy} className="text-red-500 hover:underline disabled:opacity-50">Hapus</button>
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          {runTotalPages > 1 && (
                            <div className="mt-3 flex items-center justify-center gap-2">
                              <button onClick={() => { if (runPage > 1) { setRunLoading(true); loadRuns(selected.id, runPage - 1); } }} disabled={runPage <= 1 || runLoading} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">← Prev</button>
                              <span className="text-xs text-slate-500 dark:text-slate-400">{runPage} / {runTotalPages}</span>
                              <button onClick={() => { if (runPage < runTotalPages) { setRunLoading(true); loadRuns(selected.id, runPage + 1); } }} disabled={runPage >= runTotalPages || runLoading} className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Next →</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="hidden flex-1 items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/30 p-12 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/20 lg:flex">
                    Pilih job backup untuk melihat detail
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
