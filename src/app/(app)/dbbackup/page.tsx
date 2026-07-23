"use client";

import { useCallback, useEffect, useState } from "react";
import TimeField from "@/components/TimeField";

type Conn = { id: string; name: string; host: string; port: number; username: string; jobCount: number };
type Team = { id: string; name: string };
type Run = { id: string; status: string; message: string | null; sizeBytes: number | null; location: string | null; startedAt: string; endedAt: string | null };
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
  dest: Record<string, unknown>;
  retention: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  runs: Run[];
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

function scheduleLabel(j: Job): string {
  if (j.scheduleType === "daily") return `Harian ${j.timeAt}`;
  if (j.scheduleType === "weekly") return `Mingguan, ${DAY_NAMES[j.dayOn ?? 0]} ${j.timeAt}`;
  if (j.scheduleType === "monthly") return `Bulanan, tgl ${j.dayOn} ${j.timeAt}`;
  return `Cron: ${j.cronExpr}`;
}

export default function DbBackupPage() {
  const [conns, setConns] = useState<Conn[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // form koneksi
  const [nc, setNc] = useState({ name: "", host: "", port: "3306", username: "", password: "" });
  const [editConnId, setEditConnId] = useState<string | null>(null);
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
  const [dest, setDest] = useState<Record<string, string>>({});
  const [jRetention, setJRetention] = useState(0);

  const load = useCallback(async () => {
    const [cRes, jRes, tRes] = await Promise.all([fetch("/api/db/connections"), fetch("/api/db/jobs"), fetch("/api/teams")]);
    if (cRes.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    const c = await cRes.json();
    const j = await jRes.json();
    const t = await tRes.json();
    setConns(c.data ?? []);
    setJobs(j.data ?? []);
    setTeams(t.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // auto-refresh ringan saat ada job yang sedang berjalan
  useEffect(() => {
    if (!jobs.some((j) => j.lastStatus === "running")) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [jobs, load]);

  // Handle OAuth redirect messages
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ok = params.get("gdrive_ok");
    const err = params.get("gdrive_error");
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

  async function createJob(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: jName,
      connectionId: jConn,
      databases: [...jDbs],
      scheduleType: jType,
      ...(jType === "cron" ? { cronExpr: jCron } : { timeAt: jTime }),
      ...(jType === "weekly" ? { dayOn: jDay } : jType === "monthly" ? { dayOn: jDate } : {}),
      destType: jDest,
      dest: Object.fromEntries(Object.entries(dest).filter(([, v]) => v !== "")),
      retention: jRetention,
    };
    const url = editJobId ? `/api/db/jobs/${editJobId}` : "/api/db/jobs";
    const method = editJobId ? "PATCH" : "POST";
    const ok = await api(url, method, body);
    if (ok) {
      setShowJobForm(false);
      setEditJobId(null);
      setJName("");
      setJDbs(new Set());
      setDest({});
      setJRetention(0);
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
    setDest(j.dest as Record<string, string>);
    setJRetention(j.retention);
    setShowJobForm(true);
    // load database list for the connection
    loadDatabases(j.connection.id, true);
  }

  if (forbidden) {
    return <p className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">Halaman ini hanya untuk admin.</p>;
  }

  const D = (k: string) => dest[k] ?? "";
  const setD = (k: string, v: string) => setDest((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Backup Database</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Backup MySQL terjadwal ke lokal, FTP, atau S3. Untuk SMB: mount share-nya dulu (Finder → Go → Connect to
          Server), lalu pakai tujuan <b>Lokal</b> dengan path mount tersebut.
        </p>
      </div>

      {/* ===== koneksi ===== */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Koneksi MySQL</h2>
        <form
          className={`${card} mb-4 flex flex-wrap items-end gap-3`}
          onSubmit={async (e) => {
            e.preventDefault();
            if (editConnId) {
              const ok = await api(`/api/db/connections/${editConnId}`, "PATCH", { ...nc, port: Number(nc.port) || 3306 });
              if (ok) {
                setEditConnId(null);
                setNc({ name: "", host: "", port: "3306", username: "", password: "" });
                setMsg({ text: "Koneksi diperbarui.", ok: true });
              }
            } else {
              const ok = await api("/api/db/connections", "POST", { ...nc, port: Number(nc.port) || 3306 });
              if (ok) {
                setNc({ name: "", host: "", port: "3306", username: "", password: "" });
                setMsg({ text: "Koneksi tersimpan (tes koneksi berhasil).", ok: true });
              }
            }
          }}
        >
          <div><label className={label}>Nama</label><input required value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} placeholder="mis. DB Produksi" className={`${input} mt-1 w-36`} /></div>
          <div><label className={label}>Host</label><input required value={nc.host} onChange={(e) => setNc({ ...nc, host: e.target.value })} placeholder="103.x.x.x" className={`${input} mt-1 w-40`} /></div>
          <div><label className={label}>Port</label><input value={nc.port} onChange={(e) => setNc({ ...nc, port: e.target.value })} className={`${input} mt-1 w-20`} /></div>
          <div><label className={label}>Username</label><input required value={nc.username} onChange={(e) => setNc({ ...nc, username: e.target.value })} className={`${input} mt-1 w-32`} /></div>
          <div><label className={label}>Password</label><input type="password" value={nc.password} onChange={(e) => setNc({ ...nc, password: e.target.value })} placeholder={editConnId ? "Kosongkan jika tidak diubah" : ""} className={`${input} mt-1 w-36`} /></div>
          <div className="flex gap-2">
            <button disabled={busy} className={btnPrimary}>{busy ? "…" : editConnId ? "Simpan edit" : "Tes & simpan"}</button>
            {editConnId && <button type="button" onClick={() => { setEditConnId(null); setNc({ name: "", host: "", port: "3306", username: "", password: "" }); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Batal</button>}
          </div>
        </form>

        {msg && !showJobForm && (
          <div className={`mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300" : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"}`}>
            <span className="flex-1">{msg.text}</span>
            <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
          </div>
        )}

        {loading ? (
          <div className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
        ) : conns.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada koneksi.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {conns.map((c) => (
              <div key={c.id} className={`${card} flex items-center justify-between gap-3 !p-4`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{c.name}</p>
                  <p className="truncate text-xs text-slate-400">{c.username}@{c.host}:{c.port} · {c.jobCount} job</p>
                </div>
                <div className="flex shrink-0 gap-2 text-xs">
                  <button
                    onClick={() => { setEditConnId(c.id); setNc({ name: c.name, host: c.host, port: String(c.port), username: c.username, password: "" }); }}
                    className="font-medium text-slate-500 hover:underline dark:text-slate-400"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => { setCloneConnId(c.id); setCloneTeamId(""); }}
                    className="font-medium text-sky-600 hover:underline dark:text-sky-400"
                  >
                    Clone
                  </button>
                  <button
                    onClick={() => confirm(`Hapus koneksi "${c.name}" beserta job backup-nya?`) && api(`/api/db/connections/${c.id}`, "DELETE")}
                    className="font-medium text-red-500 hover:underline"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Clone modal */}
      {cloneConnId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Clone Koneksi ke Tim Lain</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Koneksi dan semua job-nya akan disalin ke tim tujuan.</p>
            <select
              value={cloneTeamId}
              onChange={(e) => setCloneTeamId(e.target.value)}
              className={`${input} mt-4 w-full`}
            >
              <option value="">— pilih tim tujuan —</option>
              {teams.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setCloneConnId(null); setCloneTeamId(""); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Batal</button>
              <button
                disabled={!cloneTeamId || busy}
                onClick={async () => {
                  setBusy(true);
                  const res = await fetch(`/api/db/connections/${cloneConnId}/clone`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ teamId: cloneTeamId }),
                  });
                  const d = await res.json().catch(() => ({}));
                  setBusy(false);
                  if (!res.ok || d.ok === false) {
                    setMsg({ text: d.message ?? "Gagal clone", ok: false });
                  } else {
                    setMsg({ text: `Berhasil clone + ${d.data?.jobCount ?? 0} job.`, ok: true });
                    setCloneConnId(null);
                    setCloneTeamId("");
                    load();
                  }
                }}
                className={btnPrimary}
              >
                {busy ? "…" : "Clone"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== jobs ===== */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Job Backup</h2>
          <button onClick={() => { setShowJobForm(!showJobForm); setEditJobId(null); setJName(""); setJDbs(new Set()); setDest({}); setJRetention(0); }} disabled={conns.length === 0} className={btnPrimary}>
            {showJobForm ? "Tutup form" : "+ Buat job"}
          </button>
        </div>

        {showJobForm && (
          <form onSubmit={createJob} className={`${card} animate-fade-up mb-4 space-y-5`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editJobId ? "Edit Job Backup" : "Buat Job Backup"}</h3>
              <button type="button" onClick={() => { setShowJobForm(false); setEditJobId(null); }} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">✕ Tutup</button>
            </div>

            {msg && (
              <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300" : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"}`}>
                <span className="flex-1">{msg.text}</span>
                <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
              </div>
            )}
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

            {/* database */}
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
                        <button
                          type="button"
                          key={db}
                          onClick={() => setJDbs((s) => { const n = new Set(s); if (on) n.delete(db); else n.add(db); return n; })}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${on ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
                        >
                          {on ? "✓ " : ""}{db}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* jadwal */}
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className={label}>Jadwal</label>
                <select value={jType} onChange={(e) => setJType(e.target.value)} className={`${input} mt-1`}>
                  <option value="daily">Harian</option>
                  <option value="weekly">Mingguan</option>
                  <option value="monthly">Bulanan</option>
                  <option value="cron">Cron expression</option>
                </select>
              </div>
              {jType === "weekly" && (
                <div>
                  <label className={label}>Hari</label>
                  <select value={jDay} onChange={(e) => setJDay(Number(e.target.value))} className={`${input} mt-1`}>
                    {DAY_NAMES.map((d, i) => (<option key={i} value={i}>{d}</option>))}
                  </select>
                </div>
              )}
              {jType === "monthly" && (
                <div>
                  <label className={label}>Tanggal</label>
                  <select value={jDate} onChange={(e) => setJDate(Number(e.target.value))} className={`${input} mt-1`}>
                    {Array.from({ length: 28 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}</option>))}
                  </select>
                </div>
              )}
              {jType !== "cron" ? (
                <div>
                  <label className={label}>Jam</label>
                  <div className="mt-1"><TimeField value={jTime} onChange={setJTime} /></div>
                </div>
              ) : (
                <div>
                  <label className={label}>Cron (menit jam tgl bulan hari)</label>
                  <input value={jCron} onChange={(e) => setJCron(e.target.value)} placeholder="0 2 * * *" className={`${input} mt-1 w-40 font-mono`} />
                </div>
              )}
            </div>

            {/* tujuan */}
            <div>
              <label className={label}>Lokasi backup</label>
              <div className="mt-2 flex gap-2">
                {[
                  { v: "local", l: "💾 Lokal / SMB-mount" },
                  { v: "ftp", l: "🌐 FTP" },
                  { v: "s3", l: "☁️ S3" },
                  { v: "gdrive", l: "📁 Google Drive" },
                ].map((o) => (
                  <button
                    type="button"
                    key={o.v}
                    onClick={() => { setJDest(o.v); setDest({}); }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${jDest === o.v ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                {jDest === "local" && (
                  <div className="w-full"><label className={label}>Path folder tujuan</label><input required value={D("path")} onChange={(e) => setD("path", e.target.value)} placeholder="/home/user/backups atau /Volumes/NAS/backup" className={`${input} mt-1 w-full max-w-lg`} /></div>
                )}
                {jDest === "ftp" && (
                  <>
                    <div><label className={label}>Host</label><input required value={D("host")} onChange={(e) => setD("host", e.target.value)} className={`${input} mt-1 w-40`} /></div>
                    <div><label className={label}>Port</label><input value={D("port") || "21"} onChange={(e) => setD("port", e.target.value)} className={`${input} mt-1 w-20`} /></div>
                    <div><label className={label}>Username</label><input required value={D("username")} onChange={(e) => setD("username", e.target.value)} className={`${input} mt-1 w-32`} /></div>
                    <div><label className={label}>Password</label><input type="password" value={D("password")} onChange={(e) => setD("password", e.target.value)} className={`${input} mt-1 w-32`} /></div>
                    <div><label className={label}>Folder</label><input value={D("path") || "/"} onChange={(e) => setD("path", e.target.value)} className={`${input} mt-1 w-40`} /></div>
                  </>
                )}
                {jDest === "s3" && (
                  <>
                    <div><label className={label}>Bucket</label><input required value={D("bucket")} onChange={(e) => setD("bucket", e.target.value)} className={`${input} mt-1 w-40`} /></div>
                    <div><label className={label}>Region</label><input value={D("region")} onChange={(e) => setD("region", e.target.value)} placeholder="ap-southeast-1" className={`${input} mt-1 w-36`} /></div>
                    <div><label className={label}>Endpoint (opsional, utk R2/MinIO)</label><input value={D("endpoint")} onChange={(e) => setD("endpoint", e.target.value)} placeholder="https://…" className={`${input} mt-1 w-56`} /></div>
                    <div><label className={label}>Prefix folder</label><input value={D("prefix")} onChange={(e) => setD("prefix", e.target.value)} placeholder="mysql/" className={`${input} mt-1 w-32`} /></div>
                    <div><label className={label}>Access key</label><input required value={D("accessKeyId")} onChange={(e) => setD("accessKeyId", e.target.value)} className={`${input} mt-1 w-44`} /></div>
                    <div><label className={label}>Secret key</label><input required type="password" value={D("secretKey")} onChange={(e) => setD("secretKey", e.target.value)} className={`${input} mt-1 w-44`} /></div>
                  </>
                )}
                {jDest === "gdrive" && (
                  <>
                    <div>
                      <label className={label}>Google OAuth Client ID</label>
                      <input required value={D("clientId")} onChange={(e) => setD("clientId", e.target.value)} placeholder="xxxx.apps.googleusercontent.com" className={`${input} mt-1 w-80`} />
                      <p className="mt-1 text-[11px] text-slate-400">Buat OAuth 2.0 Client ID di Google Cloud Console (type: Web Application). Tambahkan redirect URI: <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">{typeof window !== "undefined" ? window.location.origin : ""}/api/db/gdrive/callback</code></p>
                    </div>
                    <div>
                      <label className={label}>Google OAuth Client Secret</label>
                      <input type="password" required value={D("clientSecret")} onChange={(e) => setD("clientSecret", e.target.value)} placeholder="GOCSPX-..." className={`${input} mt-1 w-80`} />
                    </div>
                    {D("gdriveConnected") === "true" && (
                      <div className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-400">
                        ✅ Terkoneksi sebagai <b>{D("gdriveUserEmail") || "akun Google"}</b>
                      </div>
                    )}
                    <div>
                      <label className={label}>Folder ID (opsional)</label>
                      <input value={D("folderId")} onChange={(e) => setD("folderId", e.target.value)} placeholder="Kosongkan = simpan di root My Drive" className={`${input} mt-1 w-64`} />
                      <p className="mt-1 text-[11px] text-slate-400">Folder ID dari: drive.google.com/drive/folders/<b>FOLDER_ID</b>. Kosongkan untuk simpan di root Drive.</p>
                    </div>
                    {D("clientId") && D("clientSecret") && (
                      <div className="w-full">
                        {editJobId ? (
                          <a
                            href={`/api/db/gdrive/auth?jobId=${editJobId}`}
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500"
                          >
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#fff"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#fff" opacity=".8"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fff" opacity=".6"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#fff" opacity=".9"/></svg>
                            Login Google
                          </a>
                        ) : (
                          <p className="text-[11px] text-slate-400 mt-1">Simpan job dulu, lalu klik Edit untuk Login Google.</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* retensi */}
            <div>
              <label className={label}>Retensi backup</label>
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={jRetention}
                  onChange={(e) => setJRetention(Number(e.target.value) || 0)}
                  className={`${input} w-24`}
                />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {jRetention === 0 ? "Simpan semua" : `Simpan ${jRetention} backup terakhir`}
                </span>
              </div>
            </div>

            <div className="flex justify-end">
              <button disabled={busy || jDbs.size === 0} className={btnPrimary}>
                {busy ? "Menyimpan…" : editJobId ? `Perbarui job (${jDbs.size} database)` : `Simpan job (${jDbs.size} database)`}
              </button>
            </div>
          </form>
        )}

        {loading ? null : jobs.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
            Belum ada job backup. Tambahkan koneksi lalu buat job.
          </p>
        ) : (
          <div className="space-y-4">
            {jobs.map((j) => (
              <div key={j.id} className={card}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {j.name}
                      {j.lastStatus && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${j.lastStatus === "success" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : j.lastStatus === "running" ? "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-400" : "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400"}`}>
                          {j.lastStatus === "running" ? "berjalan…" : j.lastStatus}
                        </span>
                      )}
                      {!j.enabled && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">nonaktif</span>}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {j.connection.name} · {j.databases.join(", ")} · {scheduleLabel(j)} · →{" "}
                      {j.destType === "local" ? `📁 ${j.dest.path}` : j.destType === "ftp" ? `FTP ${j.dest.host}` : j.destType === "gdrive" ? "📂 Google Drive" : `S3 ${j.dest.bucket}`}
                      {j.retention > 0 ? ` · Retensi: ${j.retention}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2 text-xs">
                    <button onClick={() => api(`/api/db/jobs/${j.id}/run`, "POST")} disabled={busy || j.lastStatus === "running"} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50">
                      ▶ Jalankan
                    </button>
                    <button onClick={() => api(`/api/db/jobs/${j.id}`, "PATCH", { enabled: !j.enabled })} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                      {j.enabled ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                    <button onClick={() => openEdit(j)} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                      Edit
                    </button>
                    <button onClick={() => confirm(`Hapus job "${j.name}"?`) && api(`/api/db/jobs/${j.id}`, "DELETE")} disabled={busy} className="rounded-lg px-2 py-1.5 font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40">
                      Hapus
                    </button>
                  </div>
                </div>

                {j.runs.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 dark:border-slate-800">
                    {j.runs.map((r) => {
                      const runOk = r.status === "success";
                      return (
                      <p key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className={r.status === "success" ? "text-emerald-600" : r.status === "running" ? "text-sky-600" : "text-red-500"}>
                          {r.status === "success" ? "✓" : r.status === "running" ? "⟳" : "✕"} {r.status}
                        </span>
                        <span>{new Date(r.startedAt).toLocaleString("id-ID")}</span>
                        <span>{fmtSize(r.sizeBytes)}</span>
                        {r.location && <span className="max-w-[240px] truncate font-mono">{r.location}</span>}
                        {r.message && r.status === "failed" && <span className="text-red-500">{r.message}</span>}
                        <span className="ml-auto flex items-center gap-2">
                          {runOk && (
                            <a href={`/api/db/runs/${r.id}/download`} className="text-sky-600 hover:underline dark:text-sky-400">Unduh</a>
                          )}
                          {runOk && (
                            <button
                              onClick={() => { if (confirm("Restore backup ini ke database tujuan? Data saat ini akan ditimpa.")) api(`/api/db/runs/${r.id}/restore`, "POST"); }}
                              disabled={busy}
                              className="text-amber-600 hover:underline disabled:opacity-50 dark:text-amber-400"
                            >
                              Restore
                            </button>
                          )}
                          <button
                            onClick={() => { if (confirm("Hapus catatan backup ini beserta filenya?")) api(`/api/db/runs/${r.id}`, "DELETE"); }}
                            disabled={busy}
                            className="text-red-500 hover:underline disabled:opacity-50"
                          >
                            Hapus
                          </button>
                        </span>
                      </p>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
