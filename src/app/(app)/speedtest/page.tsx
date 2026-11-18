"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TimeField from "@/components/TimeField";
import ReportChart, { StatTiles, type ChartSpec, type StatItem } from "@/components/ReportChart";
import { useLang } from "@/lib/i18n";

type SshOpt = { id: string; name: string; host: string; port: number; username: string };

type LastResult = {
  startedAt: string;
  tool: string | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  pingMs: number | null;
  jitterMs: number | null;
  serverName: string | null;
  serverLocation: string | null;
};

type Job = {
  id: string;
  name: string;
  sshId: string;
  tool: string;
  serverId: string | null;
  scheduleType: string;
  timeAt: string | null;
  dayOn: number | null;
  cronExpr: string | null;
  timezone: string;
  timeoutSec: number;
  minDownloadMbps: number | null;
  enabled: boolean;
  lastStatus: string | null;
  lastRunAt: string | null;
  ssh: { id: string; name: string; host: string } | null;
  _count: { results: number };
  last: LastResult | null;
  lastError: string | null;
};

type Row = LastResult & {
  id: string;
  status: string;
  trigger: string;
  packetLoss: number | null;
  isp: string | null;
  externalIp: string | null;
  resultUrl: string | null;
  error: string | null;
};
type Day = { day: string; tests: number; failed: number; downAvg: number | null; downMin: number | null; upAvg: number | null; pingAvg: number | null; jitterAvg: number | null; lossAvg: number | null };
type Hour = { hour: number; tests: number; downAvg: number | null; upAvg: number | null };
type Summary = {
  total: number;
  success: number;
  failed: number;
  successRate: number | null;
  downAvg: number | null;
  downMin: number | null;
  downMax: number | null;
  upAvg: number | null;
  upMin: number | null;
  upMax: number | null;
  pingAvg: number | null;
  jitterAvg: number | null;
  lossAvg: number | null;
};
type Detail = { rows: Row[]; daily: Day[]; hourly: Hour[]; summary: Summary; running: boolean; timezone: string };

const COLORS = { download: "#2a78d6", upload: "#eb6834", ping: "#1baf7a", jitter: "#eda100", loss: "#6250d6" };
const DAY_KEYS = ["sshcmd.day.0", "sshcmd.day.1", "sshcmd.day.2", "sshcmd.day.3", "sshcmd.day.4", "sshcmd.day.5", "sshcmd.day.6"];
const TOOLS = ["auto", "ookla", "speedtest-cli", "curl"] as const;
const RANGES = [7, 30, 90, 365];
const PAGE = 20;

const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const label = "block text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btnPrimary =
  "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";
const btnGhost =
  "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";

const nf = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toLocaleString("id-ID", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : d }));
const mbps = (v: number | null | undefined) => (v == null ? "—" : `${nf(v)} Mbps`);
const ms = (v: number | null | undefined) => (v == null ? "—" : `${nf(v)} ms`);
const fmtTime = (s?: string | null) => (s ? new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "—");
const shortTime = (s: string) => new Date(s).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function statusBadge(s: string | null) {
  return s === "success"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900"
    : s === "failed"
      ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900"
      : s === "running"
        ? "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-400 dark:ring-sky-900"
        : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700";
}

/* ------------------------------------------------------------------ */
/* Panel grafik & riwayat satu job                                      */
/* ------------------------------------------------------------------ */
function JobDetail({ job, refreshKey }: { job: Job; refreshKey: string }) {
  const { t } = useLang();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/speedtest/${job.id}/results?days=${days}`);
      const d = await res.json();
      if (d.ok) setData(d.data);
    } finally {
      setLoading(false);
    }
  }, [job.id, days]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load, refreshKey]);

  // polling ringan selama ada tes berjalan
  useEffect(() => {
    if (!data?.running) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [data?.running, load]);

  const charts = useMemo(() => {
    if (!data) return [] as ChartSpec[];
    const ok = data.rows.filter((r) => r.status === "success");
    const daily = data.daily;
    const out: ChartSpec[] = [];
    if (ok.length >= 2 && ok.length <= 400) {
      out.push({
        chart: "line",
        title: t("st.chartPerTest"),
        unit: "Mbps",
        labels: ok.map((r) => shortTime(r.startedAt)),
        series: [
          { name: t("st.download"), color: COLORS.download, values: ok.map((r) => r.downloadMbps) },
          { name: t("st.upload"), color: COLORS.upload, values: ok.map((r) => r.uploadMbps) },
        ],
      });
    }
    if (daily.length >= 2) {
      out.push({
        chart: daily.length <= 45 ? "bar" : "line",
        title: t("st.chartDaily"),
        unit: "Mbps",
        labels: daily.map((d) => shortDay(d.day)),
        series: [
          { name: t("st.download"), color: COLORS.download, values: daily.map((d) => d.downAvg) },
          { name: t("st.upload"), color: COLORS.upload, values: daily.map((d) => d.upAvg) },
        ],
      });
      out.push({
        chart: "line",
        title: t("st.chartLatency"),
        unit: "ms",
        labels: daily.map((d) => shortDay(d.day)),
        series: [
          { name: t("st.ping"), color: COLORS.ping, values: daily.map((d) => d.pingAvg) },
          { name: t("st.jitter"), color: COLORS.jitter, values: daily.map((d) => d.jitterAvg) },
        ],
      });
    } else if (ok.length >= 2) {
      out.push({
        chart: "line",
        title: t("st.chartLatencyTest"),
        unit: "ms",
        labels: ok.map((r) => shortTime(r.startedAt)),
        series: [
          { name: t("st.ping"), color: COLORS.ping, values: ok.map((r) => r.pingMs) },
          { name: t("st.jitter"), color: COLORS.jitter, values: ok.map((r) => r.jitterMs) },
        ],
      });
    }
    if (data.hourly.filter((h) => h.tests > 0).length >= 3) {
      out.push({
        chart: "bar",
        title: t("st.chartHourly"),
        unit: "Mbps",
        labels: data.hourly.map((h) => String(h.hour).padStart(2, "0")),
        series: [{ name: t("st.download"), color: COLORS.download, values: data.hourly.map((h) => h.downAvg) }],
        caption: data.timezone,
      });
    }
    if (daily.some((d) => d.lossAvg != null && d.lossAvg > 0)) {
      out.push({
        chart: "line",
        title: t("st.chartLoss"),
        unit: "%",
        labels: daily.map((d) => shortDay(d.day)),
        series: [{ name: t("st.loss"), color: COLORS.loss, values: daily.map((d) => d.lossAvg) }],
      });
    }
    return out;
  }, [data, t]);

  const tiles: StatItem[] = useMemo(() => {
    if (!data) return [];
    const s = data.summary;
    return [
      { label: t("st.avgDown"), value: mbps(s.downAvg), sub: `min ${mbps(s.downMin)} · maks ${mbps(s.downMax)}`, tone: job.minDownloadMbps && s.downAvg != null && s.downAvg < job.minDownloadMbps ? "bad" : "neutral" },
      { label: t("st.avgUp"), value: mbps(s.upAvg), sub: `min ${mbps(s.upMin)} · maks ${mbps(s.upMax)}` },
      { label: t("st.avgPing"), value: ms(s.pingAvg), sub: `jitter ${ms(s.jitterAvg)}${s.lossAvg != null ? ` · loss ${nf(s.lossAvg)}%` : ""}` },
      {
        label: t("st.successRate"),
        value: `${s.success}/${s.success + s.failed}`,
        sub: s.successRate != null ? `${nf(s.successRate)}%` : undefined,
        tone: s.failed ? (s.success ? "warn" : "bad") : s.success ? "good" : "neutral",
      },
    ];
  }, [data, job.minDownloadMbps, t]);

  const history = useMemo(() => (data ? [...data.rows].reverse() : []), [data]);
  const pages = Math.max(1, Math.ceil(history.length / PAGE));
  const shown = history.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div className="space-y-4 border-t border-slate-100 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-950/30">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">{t("st.range")}</span>
        {RANGES.map((d) => (
          <button
            key={d}
            onClick={() => {
              setDays(d);
              setPage(0);
            }}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition ${days === d ? "bg-slate-900 text-white ring-slate-900 dark:bg-slate-100 dark:text-slate-900" : "text-slate-600 ring-slate-200 hover:bg-white dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"}`}
          >
            {d} {t("st.days")}
          </button>
        ))}
        <a href={`/api/speedtest/report?ids=${job.id}&days=${days}`} className={`${btnGhost} ml-auto`}>
          📄 {t("st.pdf")}
        </a>
      </div>

      {loading && !data ? (
        <div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      ) : !data || data.rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">{t("st.noData")}</p>
      ) : (
        <>
          <StatTiles items={tiles} />
          {charts.length > 0 && (
            <div className="grid gap-3 xl:grid-cols-2">
              {charts.map((c, i) => (
                <ReportChart key={i} spec={c} compact />
              ))}
            </div>
          )}
          <div>
            <h4 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              {t("st.history")} <span className="font-normal text-slate-400">({history.length})</span>
            </h4>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">{t("st.colTime")}</th>
                    <th className="px-2 py-1.5 text-right font-medium">{t("st.download")}</th>
                    <th className="px-2 py-1.5 text-right font-medium">{t("st.upload")}</th>
                    <th className="px-2 py-1.5 text-right font-medium">{t("st.ping")}</th>
                    <th className="px-2 py-1.5 text-right font-medium">{t("st.jitter")}</th>
                    <th className="px-2 py-1.5 text-left font-medium">{t("st.colTool")}</th>
                    <th className="px-2 py-1.5 text-left font-medium">{t("st.colServer")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {shown.map((r) => (
                    <tr key={r.id} className={r.status === "failed" ? "bg-red-50/70 dark:bg-red-950/20" : ""}>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-600 dark:text-slate-300">
                        {fmtTime(r.startedAt)}
                        {r.trigger === "scheduler" && <span className="ml-1 text-[10px] text-slate-400">⏱</span>}
                      </td>
                      {r.status === "success" ? (
                        <>
                          <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-800 dark:text-slate-100">{mbps(r.downloadMbps)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{mbps(r.uploadMbps)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{ms(r.pingMs)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{ms(r.jitterMs)}</td>
                          <td className="px-2 py-1.5 text-slate-500">{r.tool ? t(`st.tool.${r.tool}`).split(" (")[0] : "—"}</td>
                          <td className="max-w-[260px] truncate px-2 py-1.5 text-slate-500" title={[r.serverName, r.serverLocation, r.isp].filter(Boolean).join(" · ")}>
                            {r.resultUrl ? (
                              <a href={r.resultUrl} target="_blank" rel="noreferrer" className="hover:underline">
                                {[r.serverName, r.serverLocation].filter(Boolean).join(" · ") || "—"}
                              </a>
                            ) : (
                              [r.serverName, r.serverLocation].filter(Boolean).join(" · ") || "—"
                            )}
                          </td>
                        </>
                      ) : r.status === "running" ? (
                        <td colSpan={6} className="px-2 py-1.5 text-sky-600 dark:text-sky-400">
                          {t("st.running")}
                        </td>
                      ) : (
                        <td colSpan={6} className="px-2 py-1.5 text-red-600 dark:text-red-400">
                          <span className="font-semibold">{t("st.failed")}</span> — <span className="whitespace-pre-wrap">{(r.error ?? "").split("\n")[0]}</span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="mt-2 flex items-center justify-end gap-2 text-xs text-slate-500">
                <button disabled={page === 0} onClick={() => setPage(page - 1)} className={btnGhost}>
                  {t("st.prev")}
                </button>
                <span className="tabular-nums">
                  {page + 1} / {pages}
                </span>
                <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className={btnGhost}>
                  {t("st.next")}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Halaman                                                              */
/* ------------------------------------------------------------------ */
export default function SpeedtestPage() {
  const { t } = useLang();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sshs, setSshs] = useState<SshOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean; pre?: boolean } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // job yang baru dijalankan dari halaman ini → waktu klik (ms)
  const [running, setRunning] = useState<Record<string, number>>({});

  // form
  const [fName, setFName] = useState("");
  const [fSsh, setFSsh] = useState("");
  const [fTool, setFTool] = useState<string>("auto");
  const [fServerId, setFServerId] = useState("");
  const [fType, setFType] = useState("manual");
  const [fTime, setFTime] = useState("06:00");
  const [fDay, setFDay] = useState(1);
  const [fDate, setFDate] = useState(1);
  const [fCron, setFCron] = useState("0 */3 * * *");
  const [fTimeout, setFTimeout] = useState("180");
  const [fMin, setFMin] = useState("");
  const [detect, setDetect] = useState<{ loading: boolean; data?: { ookla: boolean; speedtestCli: boolean; curl: boolean; os: string | null; hint: string }; error?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [jRes, sRes] = await Promise.all([fetch("/api/speedtest"), fetch("/api/db/ssh")]);
      const j = await jRes.json().catch(() => null);
      if (jRes.ok && j?.ok) {
        const list: Job[] = j.data ?? [];
        setJobs(list);
        // lepas penanda "berjalan" setelah job benar-benar mulai lalu selesai
        setRunning((prev) => {
          const next = { ...prev };
          for (const [id, at] of Object.entries(prev)) {
            const job = list.find((x) => x.id === id);
            if (!job || Date.now() - at > 20 * 60 * 1000) delete next[id];
            else if (job.lastStatus !== "running" && job.lastRunAt && new Date(job.lastRunAt).getTime() >= at - 5000) delete next[id];
          }
          return next;
        });
      }
      else if (j?.message) setMsg({ text: j.message, ok: false });
      if (sRes.ok) setSshs((await sRes.json()).data ?? []);
    } catch {
      /* biarkan data lama */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // segarkan daftar selama ada job berjalan
  const anyRunning = jobs.some((j) => j.lastStatus === "running") || Object.keys(running).length > 0;
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [anyRunning, load]);

  function resetForm() {
    setFName("");
    setFSsh("");
    setFTool("auto");
    setFServerId("");
    setFType("manual");
    setFTime("06:00");
    setFDay(1);
    setFDate(1);
    setFCron("0 */3 * * *");
    setFTimeout("180");
    setFMin("");
    setDetect(null);
  }

  function startEdit(j: Job) {
    setEditId(j.id);
    setFName(j.name);
    setFSsh(j.sshId);
    setFTool(j.tool);
    setFServerId(j.serverId ?? "");
    setFType(j.scheduleType);
    setFTime(j.timeAt ?? "06:00");
    setFDay(j.dayOn ?? 1);
    setFDate(j.dayOn ?? 1);
    setFCron(j.cronExpr ?? "0 */3 * * *");
    setFTimeout(String(j.timeoutSec));
    setFMin(j.minDownloadMbps ? String(j.minDownloadMbps) : "");
    setDetect(null);
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
      tool: fTool,
      serverId: fServerId.trim() || null,
      scheduleType: fType,
      timeAt: ["daily", "weekly", "monthly"].includes(fType) ? fTime : "",
      dayOn: fType === "weekly" ? fDay : fType === "monthly" ? fDate : null,
      cronExpr: fType === "cron" ? fCron : "",
      timeoutSec: Number(fTimeout) || 180,
      minDownloadMbps: fMin.trim() ? Number(fMin) : null,
    };
    try {
      const res = await fetch(editId ? `/api/speedtest/${editId}` : "/api/speedtest", {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!d.ok) {
        setMsg({ text: d.message ?? "Error", ok: false });
        return;
      }
      setMsg({ text: t("st.saved"), ok: true });
      setShowForm(false);
      setEditId(null);
      resetForm();
      load();
    } finally {
      setBusy(false);
    }
  }

  async function runDetect() {
    if (!fSsh) return;
    setDetect({ loading: true });
    try {
      const res = await fetch("/api/speedtest/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sshId: fSsh }) });
      const d = await res.json();
      setDetect(d.ok ? { loading: false, data: d.data } : { loading: false, error: d.message ?? "Error" });
    } catch {
      setDetect({ loading: false, error: "Error" });
    }
  }

  async function run(j: Job) {
    setBusy(true);
    try {
      const res = await fetch(`/api/speedtest/${j.id}/run`, { method: "POST" });
      const d = await res.json();
      setMsg(d.ok ? { text: `${j.name}: ${t("st.runStarted")}`, ok: true } : { text: d.message ?? "Error", ok: false });
      if (d.ok) setRunning((r) => ({ ...r, [j.id]: Date.now() }));
    } finally {
      setBusy(false);
      setTimeout(load, 1500);
    }
  }

  async function toggle(j: Job) {
    await fetch(`/api/speedtest/${j.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !j.enabled }) });
    load();
  }

  async function remove(j: Job) {
    if (!confirm(t("st.confirmDelete"))) return;
    await fetch(`/api/speedtest/${j.id}`, { method: "DELETE" });
    if (expanded === j.id) setExpanded(null);
    load();
  }

  function schedLabel(j: Job): string {
    switch (j.scheduleType) {
      case "manual":
        return t("st.sched.manual");
      case "hourly":
        return t("st.sched.hourly");
      case "daily":
        return `${t("st.sched.daily")} ${j.timeAt ?? ""}`;
      case "weekly":
        return `${t("st.sched.weekly")}, ${t(DAY_KEYS[j.dayOn ?? 0])} ${j.timeAt ?? ""}`;
      case "monthly":
        return `${t("st.sched.monthly")} ${j.dayOn} ${j.timeAt ?? ""}`;
      default:
        return `Cron ${j.cronExpr ?? ""}`;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">🚀 {t("st.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{t("st.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          {jobs.length > 0 && (
            <a href={`/api/speedtest/report?days=${30}`} className={`${btnGhost} !py-2`} download>
              📄 {t("st.pdfAll")}
            </a>
          )}
          <button
            onClick={() => {
              setShowForm(!showForm);
              setEditId(null);
              if (!showForm) resetForm();
            }}
            className={btnPrimary}
          >
            {showForm ? t("st.close") : t("st.add")}
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300" : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"}`}
        >
          <span className="flex-1 whitespace-pre-wrap">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className={`${card} animate-fade-up space-y-5 p-5`}>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editId ? t("st.formEdit") : t("st.formCreate")}</h2>
          <div className="flex flex-wrap gap-4">
            <div>
              <label className={label}>{t("st.name")}</label>
              <input required maxLength={120} value={fName} onChange={(e) => setFName(e.target.value)} placeholder={t("st.namePh")} className={`${input} mt-1 w-60`} />
            </div>
            <div>
              <label className={label}>{t("st.ssh")}</label>
              <select
                required
                value={fSsh}
                onChange={(e) => {
                  setFSsh(e.target.value);
                  setDetect(null);
                }}
                className={`${input} mt-1 w-72`}
              >
                <option value="">{t("st.pickSsh")}</option>
                {sshs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.username}@{s.host}:{s.port})
                  </option>
                ))}
              </select>
              {sshs.length === 0 && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{t("st.noSsh")}</p>}
            </div>
            <div>
              <label className={label}>{t("st.tool")}</label>
              <select value={fTool} onChange={(e) => setFTool(e.target.value)} className={`${input} mt-1`}>
                {TOOLS.map((x) => (
                  <option key={x} value={x}>
                    {t(`st.tool.${x}`)}
                  </option>
                ))}
              </select>
            </div>
            {(fTool === "ookla" || fTool === "speedtest-cli" || fTool === "auto") && (
              <div>
                <label className={label}>{t("st.serverId")}</label>
                <input value={fServerId} onChange={(e) => setFServerId(e.target.value.replace(/[^0-9]/g, ""))} placeholder={t("st.serverIdPh")} className={`${input} mt-1 w-44`} />
              </div>
            )}
          </div>

          <div className="rounded-xl border border-dashed border-slate-200 p-3 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={runDetect} disabled={!fSsh || detect?.loading} className={btnGhost}>
                🔍 {detect?.loading ? t("st.detecting") : t("st.detect")}
              </button>
              {detect?.data && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {(
                    [
                      ["Ookla", detect.data.ookla],
                      ["speedtest-cli", detect.data.speedtestCli],
                      ["curl", detect.data.curl],
                    ] as [string, boolean][]
                  ).map(([n, ok]) => (
                    <span key={n} className={`rounded-full px-2 py-0.5 ring-1 ${ok ? statusBadge("success") : statusBadge(null)}`}>
                      {ok ? "✓" : "✕"} {n}
                    </span>
                  ))}
                  {detect.data.os && <span className="text-slate-400">{detect.data.os}</span>}
                </div>
              )}
              {detect?.error && <span className="text-xs text-red-600 dark:text-red-400">{detect.error}</span>}
            </div>
            {detect?.data && !detect.data.ookla && !detect.data.speedtestCli && (
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{detect.data.hint}</pre>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className={label}>{t("st.schedule")}</label>
              <select value={fType} onChange={(e) => setFType(e.target.value)} className={`${input} mt-1`}>
                {["manual", "hourly", "daily", "weekly", "monthly", "cron"].map((x) => (
                  <option key={x} value={x}>
                    {t(`st.sched.${x}`)}
                  </option>
                ))}
              </select>
            </div>
            {fType === "weekly" && (
              <div>
                <label className={label}>{t("st.day")}</label>
                <select value={fDay} onChange={(e) => setFDay(Number(e.target.value))} className={`${input} mt-1`}>
                  {DAY_KEYS.map((d, i) => (
                    <option key={i} value={i}>
                      {t(d)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {fType === "monthly" && (
              <div>
                <label className={label}>{t("st.date")}</label>
                <select value={fDate} onChange={(e) => setFDate(Number(e.target.value))} className={`${input} mt-1`}>
                  {Array.from({ length: 28 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {["daily", "weekly", "monthly"].includes(fType) && (
              <div>
                <label className={label}>{t("st.time")}</label>
                <div className="mt-1">
                  <TimeField value={fTime} onChange={setFTime} />
                </div>
              </div>
            )}
            {fType === "cron" && (
              <div>
                <label className={label}>{t("st.cron")}</label>
                <input value={fCron} onChange={(e) => setFCron(e.target.value)} className={`${input} mt-1 w-40 font-mono`} />
                <p className="mt-0.5 text-[10px] text-slate-400">{t("st.cronHint")}</p>
              </div>
            )}
            <div>
              <label className={label}>{t("st.timeout")}</label>
              <input type="number" min={30} max={900} value={fTimeout} onChange={(e) => setFTimeout(e.target.value)} className={`${input} mt-1 w-24`} />
            </div>
            <div>
              <label className={label}>{t("st.minDown")}</label>
              <input type="number" min={0} step="any" value={fMin} onChange={(e) => setFMin(e.target.value)} placeholder="—" className={`${input} mt-1 w-28`} />
              <p className="mt-0.5 text-[10px] text-slate-400">{t("st.minDownHint")}</p>
            </div>
          </div>

          <div className="flex justify-end">
            <button disabled={busy} className={btnPrimary}>
              {busy ? "…" : editId ? t("st.save") : t("st.create")}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
      ) : jobs.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">{t("st.empty")}</p>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => {
            const isRunning = j.lastStatus === "running" || !!running[j.id];
            const missing = j.lastStatus === "failed" && (j.lastError ?? "").includes("Pasang salah satu tool");
            return (
              <div key={j.id} className={`${card} overflow-hidden`}>
                <div className="flex flex-wrap items-center gap-4 p-4">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusBadge(isRunning ? "running" : j.lastStatus)}`}>
                    {isRunning ? t("st.running") : (j.lastStatus ?? t("st.notRun"))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{j.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {j.ssh?.name ?? "?"} ({j.ssh?.host}) · {t(`st.tool.${j.tool}`).split(" (")[0]} · {schedLabel(j)}
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      {j._count.results} {t("st.tests")} · {fmtTime(j.lastRunAt)}
                    </p>
                  </div>
                  {j.last && (
                    <div className="flex shrink-0 gap-4 text-right">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">↓ {t("st.download")}</p>
                        <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{mbps(j.last.downloadMbps)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">↑ {t("st.upload")}</p>
                        <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{mbps(j.last.uploadMbps)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("st.ping")}</p>
                        <p className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{ms(j.last.pingMs)}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                    <button
                      onClick={() => toggle(j)}
                      className={`rounded-full px-2.5 py-1 font-medium ring-1 transition ${j.enabled ? statusBadge("success") : statusBadge(null)}`}
                    >
                      {j.enabled ? t("st.active") : t("st.inactive")}
                    </button>
                    <button
                      onClick={() => run(j)}
                      disabled={busy || isRunning}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                    >
                      {isRunning ? t("st.running") : t("st.run")}
                    </button>
                    <button onClick={() => setExpanded(expanded === j.id ? null : j.id)} className={btnGhost}>
                      📈 {expanded === j.id ? t("st.hideCharts") : t("st.charts")}
                    </button>
                    <button onClick={() => startEdit(j)} className="rounded-lg px-2.5 py-1.5 font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
                      {t("st.edit")}
                    </button>
                    <button onClick={() => remove(j)} className="rounded-lg px-2.5 py-1.5 font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950">
                      {t("st.delete")}
                    </button>
                  </div>
                </div>
                {j.lastStatus === "failed" && j.lastError && (
                  <div className="mx-4 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    <p className="font-semibold">{missing ? t("st.installTitle") : t("st.lastError")}</p>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">{j.lastError}</pre>
                  </div>
                )}
                {expanded === j.id && <JobDetail job={j} refreshKey={`${j.lastRunAt ?? ""}|${j.lastStatus ?? ""}`} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
