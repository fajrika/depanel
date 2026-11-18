"use client";

import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Run = {
  id: string;
  status: string;
  exitCode: number | null;
  output: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
};

type Page = { data: Run[]; page: number; pages: number; total: number };

const PAGE_SIZE = 10;

const field =
  "rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const ghostBtn =
  "rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:ring-slate-700 dark:hover:bg-slate-800";

function statusCls(s: string) {
  return s === "success"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900"
    : s === "failed"
      ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900"
      : "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-400 dark:ring-sky-900";
}

function fmtTime(s?: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "medium" });
}

function fmtDur(a: string, b: string | null): string {
  if (!b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function firstLine(s: string | null): string {
  return (s ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

/** Tanggal input (YYYY-MM-DD, waktu lokal browser) → ISO untuk API. */
function dayStart(d: string) {
  return d ? new Date(`${d}T00:00:00`).toISOString() : "";
}
function dayEnd(d: string) {
  return d ? new Date(`${d}T23:59:59.999`).toISOString() : "";
}

/**
 * Riwayat eksekusi satu job SSH command: dipaginasi 10 per halaman (tanpa batas ke
 * belakang), tiap entri collapsible, dengan filter status/tanggal dan ekspor PDF.
 * `refreshKey` berubah (mis. lastRunAt) → halaman dimuat ulang.
 */
export default function SshCmdHistory({ jobId, refreshKey }: { jobId: string; refreshKey?: string | null }) {
  const { t } = useLang();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeOutput, setIncludeOutput] = useState(true);
  const [res, setRes] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filterQs = useCallback(() => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (from) qs.set("from", dayStart(from));
    if (to) qs.set("to", dayEnd(to));
    return qs;
  }, [status, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filterQs();
      qs.set("page", String(page));
      qs.set("pageSize", String(PAGE_SIZE));
      const r = await fetch(`/api/sshcmd/${jobId}/runs?${qs}`);
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.message);
      setRes(d);
      setErr(null);
      if (d.page !== page) setPage(d.page);
    } catch (e) {
      setErr((e as Error).message || t("sshcmd.hist.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [jobId, page, filterQs, t]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Saat ada run yang masih berjalan, segarkan otomatis tiap 5 detik.
  const hasRunning = res?.data.some((r) => r.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [hasRunning, load]);

  function toggle(id: string) {
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const runs = res?.data ?? [];
  const allOpen = runs.length > 0 && runs.every((r) => open.has(r.id));
  const pdfQs = filterQs();
  if (!includeOutput) pdfQs.set("output", "0");
  const hasFilter = !!(status || from || to);

  return (
    <div className="border-t border-slate-100 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2 dark:border-slate-800 dark:bg-slate-800/30">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={field}>
          <option value="">{t("sshcmd.hist.allStatus")}</option>
          <option value="success">{t("sshcmd.hist.success")}</option>
          <option value="failed">{t("sshcmd.hist.failed")}</option>
          <option value="running">{t("sshcmd.hist.running")}</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          {t("sshcmd.hist.from")}
          <input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={field} />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          {t("sshcmd.hist.to")}
          <input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={field} />
        </label>
        {hasFilter && (
          <button onClick={() => { setStatus(""); setFrom(""); setTo(""); setPage(1); }} className={ghostBtn}>{t("sshcmd.hist.reset")}</button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <input type="checkbox" checked={includeOutput} onChange={(e) => setIncludeOutput(e.target.checked)} />
            {t("sshcmd.hist.includeOutput")}
          </label>
          <a href={`/api/sshcmd/${jobId}/report?${pdfQs}`} className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300">
            {t("sshcmd.hist.exportPdf")}
          </a>
        </div>
      </div>

      {err ? (
        <p className="px-4 py-3 text-xs text-red-500">{err}</p>
      ) : loading && !res ? (
        <div className="m-4 h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      ) : runs.length === 0 ? (
        <p className="px-4 py-3 text-xs text-slate-400">{hasFilter ? t("sshcmd.hist.noMatch") : t("sshcmd.noRuns")}</p>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 pt-2 text-[11px] text-slate-400">
            <span className="tabular-nums">{res?.total} {t("sshcmd.hist.total")}</span>
            <button onClick={() => setOpen(allOpen ? new Set() : new Set(runs.map((r) => r.id)))} className="hover:text-slate-600 dark:hover:text-slate-300">
              {allOpen ? t("sshcmd.hist.collapseAll") : t("sshcmd.hist.expandAll")}
            </button>
          </div>
          <div className={`divide-y divide-slate-100 dark:divide-slate-800 ${loading ? "opacity-60" : ""}`}>
            {runs.map((r) => {
              const isOpen = open.has(r.id);
              const summary = r.error ? firstLine(r.error) : firstLine(r.output);
              return (
                <div key={r.id} className="text-xs">
                  <button onClick={() => toggle(r.id)} aria-expanded={isOpen} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <span className={`w-3 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusCls(r.status)}`}>{r.status}</span>
                    <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{fmtTime(r.startedAt)}</span>
                    <span className="hidden shrink-0 tabular-nums text-slate-400 sm:inline">{fmtDur(r.startedAt, r.endedAt)}</span>
                    {r.exitCode != null && <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{t("sshcmd.runExit")} {r.exitCode}</span>}
                    <span className={`min-w-0 flex-1 truncate font-mono text-[11px] ${r.error ? "text-red-500" : "text-slate-400"}`}>{summary}</span>
                  </button>
                  {isOpen && (
                    <div className="space-y-1.5 px-4 pb-3 pl-10">
                      <p className="text-[11px] text-slate-400">
                        {fmtTime(r.startedAt)} → {fmtTime(r.endedAt)} · {t("sshcmd.hist.duration")} {fmtDur(r.startedAt, r.endedAt)}
                      </p>
                      {r.error && <p className="whitespace-pre-wrap text-red-500">{r.error}</p>}
                      {r.output ? (
                        <>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t("sshcmd.outputLabel")}</p>
                          <pre className="max-h-72 overflow-auto rounded-lg bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">{r.output}</pre>
                        </>
                      ) : (
                        !r.error && <p className="text-slate-400">{t("sshcmd.hist.noOutput")}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {res && res.pages > 1 && (
            <div className="flex flex-wrap items-center justify-center gap-2 border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <button disabled={page <= 1 || loading} onClick={() => setPage(1)} className={ghostBtn}>{t("sshcmd.hist.first")}</button>
              <button disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className={ghostBtn}>{t("sshcmd.hist.prev")}</button>
              <span className="px-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {t("sshcmd.hist.page")} {res.page} {t("sshcmd.hist.of")} {res.pages}
              </span>
              <button disabled={page >= res.pages || loading} onClick={() => setPage(page + 1)} className={ghostBtn}>{t("sshcmd.hist.next")}</button>
              <button disabled={page >= res.pages || loading} onClick={() => setPage(res.pages)} className={ghostBtn}>{t("sshcmd.hist.last")}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
