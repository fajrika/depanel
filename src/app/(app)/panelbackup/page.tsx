"use client";

import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Dest = { id: string; type: string; name: string };

type Run = {
  id: string;
  status: string;
  message: string | null;
  sizeBytes: number | null;
  location: string | null;
  startedAt: string;
};

type Pb = {
  id: string;
  name: string;
  destType: string;
  destId: string | null;
  destPath: string | null;
  scheduleType: string;
  timeAt: string | null;
  timezone: string;
  enabled: boolean;
  lastStatus: string | null;
  lastRunAt: string | null;
  runs: Run[];
};

const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const label = "block text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btnPrimary = "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

function fmtBytes(n?: number | null): string {
  if (!n) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export default function PanelBackupPage() {
  const { t } = useLang();
  const [pb, setPb] = useState<Pb | null>(null);
  const [dests, setDests] = useState<Dest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const [fName, setFName] = useState("Panel Backup");
  const [fDestType, setFDestType] = useState("local");
  const [fDestId, setFDestId] = useState("");
  const [fDestPath, setFDestPath] = useState("");
  const [fType, setFType] = useState("daily");
  const [fTime, setFTime] = useState("02:00");
  const [fDay, setFDay] = useState(1);
  const [fDate, setFDate] = useState(1);
  const [fCron, setFCron] = useState("0 2 * * *");

  const load = useCallback(async () => {
    try {
      const [pRes, dRes] = await Promise.all([fetch("/api/panelbackup"), fetch("/api/db/destinations")]);
      if (dRes.ok) setDests((await dRes.json()).data ?? []);
      if (pRes.ok) {
        const d = (await pRes.json()).data ?? null;
        setPb(d);
        if (d) {
          setFName(d.name ?? "Panel Backup");
          setFDestType(d.destType);
          setFDestId(d.destId ?? "");
          setFDestPath(d.destPath ?? "");
          setFType(d.scheduleType);
          setFTime(d.timeAt ?? "02:00");
          setFDay(d.dayOn ?? 1);
          setFDate(d.dayOn ?? 1);
          setFCron(d.cronExpr ?? "0 2 * * *");
        }
      }
    } catch {
      /* biarkan */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payload = {
      name: fName,
      destType: fDestType,
      destId: fDestId,
      destPath: fDestPath,
      scheduleType: fType,
      timeAt: fType === "daily" || fType === "weekly" || fType === "monthly" ? fTime : "",
      dayOn: fType === "weekly" ? fDay : fType === "monthly" ? fDate : null,
      cronExpr: fType === "cron" ? fCron : "",
    };
    const res = await fetch("/api/panelbackup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok || !d.ok) {
      setMsg({ text: d.message ?? t("pb.savedErr"), ok: false });
      return;
    }
    setMsg({ text: t("pb.saved"), ok: true });
    load();
  }

  async function runNow() {
    if (!pb) return;
    setBusy(true);
    const res = await fetch(`/api/panelbackup/${pb.id}/run`, { method: "POST" });
    const d = await res.json();
    setBusy(false);
    setMsg({ text: d.ok ? t("pb.started") : d.message ?? t("pb.failed"), ok: d.ok });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">🗄️ {t("pb.title")}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("pb.subtitle")}</p>
      </div>

      {msg && (
        <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300" : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"}`}>
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      <form onSubmit={submit} className={`${card} space-y-5 p-5`}>
        <div className="flex flex-wrap gap-4">
          <div><label className={label}>{t("pb.name")}</label><input required value={fName} onChange={(e) => setFName(e.target.value)} className={`${input} mt-1 w-52`} /></div>
          <div>
            <label className={label}>{t("pb.destType")}</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {[{ v: "local", l: t("pb.local") }, { v: "ftp", l: t("pb.ftp") }, { v: "s3", l: t("pb.s3") }, { v: "gdrive", l: t("pb.gdrive") }].map((o) => (
                <button
                  type="button"
                  key={o.v}
                  onClick={() => { setFDestType(o.v); setFDestId(""); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${fDestType === o.v ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {fDestType === "local" ? (
          <div className="w-full"><label className={label}>{t("pb.destPath")}</label><input required value={fDestPath} onChange={(e) => setFDestPath(e.target.value)} placeholder="/app/data/backups" className={`${input} mt-1 w-full max-w-lg font-mono`} /></div>
        ) : (
          <div className="flex flex-wrap gap-4">
            <div>
              <label className={label}>{t("pb.destConn")}</label>
              <select required value={fDestId} onChange={(e) => setFDestId(e.target.value)} className={`${input} mt-1 w-72`}>
                <option value="">—</option>
                {dests.filter((d) => d.type === fDestType).map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
              </select>
              {dests.filter((d) => d.type === fDestType).length === 0 && (
                <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{t("pb.noDest")}</p>
              )}
            </div>
            <div className="flex-1"><label className={label}>{t("pb.destPath")}</label><input required value={fDestPath} onChange={(e) => setFDestPath(e.target.value)} placeholder={t("pb.destPathPh")} className={`${input} mt-1 w-full max-w-lg font-mono`} /></div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className={label}>{t("pb.schedule")}</label>
            <select value={fType} onChange={(e) => setFType(e.target.value)} className={`${input} mt-1`}>
              <option value="manual">{t("pb.manual")}</option>
              <option value="daily">{t("pb.daily")}</option>
              <option value="weekly">{t("pb.weekly")}</option>
              <option value="monthly">{t("pb.monthly")}</option>
              <option value="cron">{t("pb.cron")}</option>
            </select>
          </div>
          {fType === "weekly" && (
            <div><label className={label}>{t("pb.dayOn")}</label><select value={fDay} onChange={(e) => setFDay(Number(e.target.value))} className={`${input} mt-1`}>{DAY_NAMES.map((d, i) => (<option key={i} value={i}>{d}</option>))}</select></div>
          )}
          {fType === "monthly" && (
            <div><label className={label}>{t("pb.dateOn")}</label><select value={fDate} onChange={(e) => setFDate(Number(e.target.value))} className={`${input} mt-1`}>{Array.from({ length: 28 }, (_, i) => (<option key={i + 1} value={i + 1}>{i + 1}</option>))}</select></div>
          )}
          {fType !== "cron" && fType !== "manual" ? (
            <div><label className={label}>{t("pb.timeAt")}</label><input type="time" value={fTime} onChange={(e) => setFTime(e.target.value)} className={`${input} mt-1`} /></div>
          ) : fType === "cron" ? (
            <div><label className={label}>{t("pb.cron")}</label><input value={fCron} onChange={(e) => setFCron(e.target.value)} placeholder={t("pb.cronPh")} className={`${input} mt-1 w-40 font-mono`} /></div>
          ) : null}
          <button disabled={busy} className={btnPrimary}>{busy ? t("pb.saving") : t("pb.save")}</button>
        </div>

        {pb && (
          <button type="button" onClick={runNow} disabled={busy} className={`${btnPrimary} !bg-emerald-600 hover:!bg-emerald-500`}>
            {busy ? t("pb.running") : t("pb.runNow")}
          </button>
        )}
      </form>

      {loading ? (
        <div className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
      ) : !pb ? (
        <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">{t("pb.empty")}</p>
      ) : (
        <div className={`${card} p-5`}>
          <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{t("pb.runsTitle")}</h3>
          {pb.runs.length === 0 ? (
            <p className="text-xs text-slate-400">{t("pb.noRuns")}</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {pb.runs.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-xs">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${r.status === "success" ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900" : r.status === "failed" ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900" : "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-400 dark:ring-sky-900"}`}>
                    {t(`pb.status.${r.status}`)}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">{new Date(r.startedAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</span>
                  <span className="tabular-nums text-slate-500 dark:text-slate-400">{fmtBytes(r.sizeBytes)}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-400">{r.location ?? r.message}</span>
                  {r.status === "success" && (
                    <a href={`/api/panelbackup/${pb.id}/runs/${r.id}/download`} className="rounded-lg border border-slate-200 px-2.5 py-1 font-medium text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
                      {t("pb.download")}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
