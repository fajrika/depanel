"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Run = { id: string; status: string; message: string | null; sizeBytes: number | null; location: string | null; startedAt: string; endedAt: string | null };
type Conn = { id: string; name: string; host: string; port: number; username: string };
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

const input = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const label = "block text-xs font-medium text-slate-500 dark:text-slate-400";

function fmtSize(n: number | null): string {
  if (!n) return "—";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function scheduleLabel(j: Job): string {
  if (j.scheduleType === "hourly") return "Perjam";
  if (j.scheduleType === "daily") return `Harian ${j.timeAt}`;
  if (j.scheduleType === "weekly") return `Mingguan, ${DAY_NAMES[j.dayOn ?? 0]} ${j.timeAt}`;
  if (j.scheduleType === "monthly") return `Bulanan, tgl ${j.dayOn} ${j.timeAt}`;
  return `Cron: ${j.cronExpr}`;
}

function destLabel(j: Job): string {
  if (j.destType === "local") return `📁 ${j.dest.path}`;
  if (j.destType === "ftp") return `FTP ${j.dest.host}`;
  if (j.destType === "gdrive") return "📂 Google Drive";
  return `S3 ${j.dest.bucket}`;
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // restore modal
  const [restoreRunId, setRestoreRunId] = useState<string | null>(null);
  const [conns, setConns] = useState<Conn[]>([]);
  const [restoreConnId, setRestoreConnId] = useState("");
  const [restoreDbList, setRestoreDbList] = useState<string[] | null>(null);
  const [restoreDbs, setRestoreDbs] = useState<Set<string>>(new Set());

  const load = async () => {
    const [jRes, cRes] = await Promise.all([fetch("/api/db/jobs"), fetch("/api/db/connections")]);
    const jD = await jRes.json();
    const cD = await cRes.json();
    const found = (jD.data ?? []).find((j: Job) => j.id === jobId);
    setJob(found ?? null);
    setConns(cD.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [jobId]);

  async function api(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || d.ok === false) { setMsg({ text: d.message ?? "Error", ok: false }); return false; }
    load();
    return true;
  }

  function openRestoreModal(runId: string) {
    if (!job) return;
    setRestoreRunId(runId);
    setRestoreConnId(job.connection.id);
    setRestoreDbs(new Set(job.databases));
    setRestoreDbList(null);
    fetch(`/api/db/connections/${job.connection.id}/databases`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setRestoreDbList(d.data); else setRestoreDbList([]); });
  }

  async function loadRestoreDatabases(connId: string) {
    setRestoreConnId(connId);
    setRestoreDbList(null);
    if (connId === job?.connection.id) {
      setRestoreDbs(new Set(job.databases));
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
    if (!restoreRunId || !job) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/db/runs/${restoreRunId}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetConnectionId: restoreConnId !== job.connection.id ? restoreConnId : undefined }),
    });
    const d = await res.json().catch(() => ({ message: `HTTP ${res.status} — tidak ada response dari server` }));
    setBusy(false);
    setRestoreRunId(null);
    if (!res.ok || d.ok === false) {
      const warnText = d.warnings?.length ? `\n\nDetail (${d.warnings.length} peringatan):\n${d.warnings.slice(0, 5).join("\n")}` : "";
      setMsg({ text: `${d.message ?? "Gagal restore"}${warnText}`, ok: false });
    } else {
      const warnText = d.warnings?.length ? ` (${d.warnings.length} peringatan — lihat log server untuk detail)` : "";
      setMsg({ text: `✓ ${d.message}${warnText}`, ok: true });
      load();
    }
  }

  if (loading) return <div className="p-4"><div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" /></div>;
  if (!job) return <div className="p-4 text-sm text-slate-500">Job tidak ditemukan.</div>;

  const btnPrimary = "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

  return (
    <div className="space-y-4 p-4">
      <button onClick={() => router.back()} className="text-sm text-slate-500 hover:underline">← Kembali</button>

      {msg && (
        <div className={`whitespace-pre-wrap rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {msg.text}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{job.name}</h2>
        <p className="mt-1 text-xs text-slate-500">{job.connection.name} ({job.connection.host}) · {job.databases.join(", ")}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{scheduleLabel(job)}</span>
          <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">→ {destLabel(job)}</span>
          {job.retention > 0 && <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">Retensi: {job.retention}</span>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => api(`/api/db/jobs/${job.id}/run`, "POST")} disabled={busy || job.lastStatus === "running"} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">▶ Jalankan</button>
          <button onClick={() => api(`/api/db/jobs/${job.id}`, "PATCH", { enabled: !job.enabled })} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600">{job.enabled ? "Nonaktifkan" : "Aktifkan"}</button>
          <button onClick={() => confirm(`Hapus job "${job.name}"?`) && api(`/api/db/jobs/${job.id}`, "DELETE")} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-medium text-red-500">Hapus</button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Riwayat Backup</h3>
        {job.runs.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">Belum ada riwayat.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {job.runs.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-100 px-3 py-2 text-[11px] dark:border-slate-800">
                <span className={r.status === "success" ? "text-emerald-600" : r.status === "running" ? "text-sky-600" : "text-red-500"}>
                  {r.status === "success" ? "✓" : r.status === "running" ? "⟳" : "✕"} {r.status}
                </span>
                <span className="text-slate-500">{new Date(r.startedAt).toLocaleString("id-ID")}</span>
                <span className="text-slate-500">{fmtSize(r.sizeBytes)}</span>
                {r.message && r.status === "failed" && <span className="text-red-500">{r.message}</span>}
                <span className="ml-auto flex items-center gap-2">
                  {r.status === "success" && <a href={`/api/db/runs/${r.id}/download`} className="text-sky-600 hover:underline">Unduh</a>}
                  {r.status === "success" && <button onClick={() => openRestoreModal(r.id)} disabled={busy} className="text-amber-600 hover:underline disabled:opacity-50">Restore</button>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Restore modal */}
      {restoreRunId && (
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
                      {c.name} ({c.host}){c.id === job.connection.id ? " — asal" : ""}
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
                      const fromBackup = job.databases.includes(db);
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
              <button onClick={() => setRestoreRunId(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Batal</button>
              <button disabled={busy || restoreDbs.size === 0} onClick={doRestore} className={btnPrimary}>
                {busy ? "Restore…" : "Restore sekarang"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
