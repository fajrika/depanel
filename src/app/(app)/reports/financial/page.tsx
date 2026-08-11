"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import TimeField from "@/components/TimeField";
import { useLang } from "@/lib/i18n";

type CreditRow = { id: number; type: string; description: string; amount: string; balance_after: string; created_at: string };
type DepositRow = {
  id: string;
  invoice_number?: string;
  description: string;
  detail?: { amount?: number; vat?: number; payment_fee?: number };
  method?: string;
  status?: string;
  created_at?: string;
};
type ReportDetailService = {
  service: string;
  total: number;
  reports: {
    service_name: string;
    service_type: string;
    total_cost: number;
    tier_name?: string;
    details: {
      name: string;
      description: string;
      base_price: number;
      total_uptime_hour: number;
      total_cost: number;
    }[];
  }[];
};
type BillingSummary = {
  current_balance?: number;
  actual_balance?: number;
  current_cost?: number;
  current_hour_cost?: number;
  estimated_monthly_total?: number;
};
type AccountReport = {
  accountName: string;
  accountId: string;
  summary?: BillingSummary;
  creditHistory?: CreditRow[];
  deposits?: DepositRow[];
  reportDetails?: ReportDetailService[];
  totals?: { topup: number; usage: number };
  error?: string;
};

function rupiah(n?: number): string {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
}

function parseAmount(str?: string): number {
  if (!str) return 0;
  return parseFloat(str.replace(/[Rp.,\s]/g, "").replace(",", ".")) || 0;
}

function fmtDate(d?: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const label = "block text-xs font-medium text-slate-500 dark:text-slate-400";
const th = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";
const td = "px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200";
const input =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const btnPrimary =
  "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

type ScheduledReport = {
  id: string;
  name: string;
  type: string;
  scheduleType: string;
  timeAt: string | null;
  dayOn: number | null;
  cronExpr: string | null;
  timezone: string;
  enabled: boolean;
  lastRunAt: string | null;
};

const RPT_DAY_NAMES = ["srp.day.0", "srp.day.1", "srp.day.2", "srp.day.3", "srp.day.4", "srp.day.5", "srp.day.6"];

function rptTypeLabel(type: string, t: (k: string) => string): string {
  if (type === "cost") return t("srp.typeCost");
  if (type === "activity") return t("srp.typeActivity");
  return t("srp.typeBackup");
}

function rptScheduleLabel(r: ScheduledReport, t: (k: string) => string): string {
  if (r.scheduleType === "daily") return `${t("srp.schedDaily")} ${r.timeAt}`;
  if (r.scheduleType === "weekly") return `${t("srp.schedWeekly")}, ${t(RPT_DAY_NAMES[r.dayOn ?? 0])} ${r.timeAt}`;
  if (r.scheduleType === "monthly") return `${t("srp.schedMonthly")}, ${t("srp.monthPrefix")} ${r.dayOn} ${r.timeAt}`;
  return `${t("srp.schedCron")}: ${r.cronExpr}`;
}

function ScheduledReportSection() {
  const { t } = useLang();
  const [reports, setReports] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [rName, setRName] = useState("");
  const [rType, setRType] = useState("cost");
  const [rSched, setRSched] = useState("daily");
  const [rTime, setRTime] = useState("08:00");
  const [rDay, setRDay] = useState(0);
  const [rDate, setRDate] = useState(1);
  const [rCron, setRCron] = useState("0 2 * * *");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/reports/scheduled");
      const d = await res.json();
      if (d.ok) setReports(d.data ?? []);
      else setMsg({ text: d.message ?? t("srp.errLoad"), ok: false });
    } catch {
      setMsg({ text: t("srp.errLoad"), ok: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (r: ScheduledReport) => {
    setEditId(r.id);
    setRName(r.name);
    setRType(r.type);
    setRSched(r.scheduleType);
    setRTime(r.timeAt ?? "08:00");
    setRDay(r.dayOn ?? 0);
    setRDate(r.dayOn ?? 1);
    setRCron(r.cronExpr ?? "0 2 * * *");
    setShowForm(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const body = {
        name: rName,
        type: rType,
        scheduleType: rSched,
        ...(rSched === "cron" ? { cronExpr: rCron } : { timeAt: rTime }),
        ...(rSched === "weekly" ? { dayOn: rDay } : rSched === "monthly" ? { dayOn: rDate } : {}),
      };
      const res = await fetch(editId ? `/api/reports/scheduled/${editId}` : "/api/reports/scheduled", {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.message ?? t("srp.errSave"));
      setMsg({ text: t("srp.saved"), ok: true });
      setShowForm(false);
      setEditId(null);
      setRName("");
      await load();
    } catch (err) {
      setMsg({ text: (err as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (r: ScheduledReport) => {
    const res = await fetch(`/api/reports/scheduled/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !r.enabled }),
    });
    const d = await res.json();
    if (!d.ok) {
      setMsg({ text: d.message ?? t("srp.errSave"), ok: false });
      return;
    }
    setReports((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: !r.enabled } : x)));
  };

  const remove = async (r: ScheduledReport) => {
    if (!window.confirm(`${t("srp.deleteConfirm")} "${r.name}"? ${t("srp.deleteConfirm2")}`)) return;
    const res = await fetch(`/api/reports/scheduled/${r.id}`, { method: "DELETE" });
    const d = await res.json();
    if (!d.ok) {
      setMsg({ text: d.message ?? t("srp.errDelete"), ok: false });
      return;
    }
    setMsg({ text: t("srp.deleted"), ok: true });
    setReports((prev) => prev.filter((x) => x.id !== r.id));
  };

  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("srp.title")}</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t("srp.subtitle")}</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setEditId(null); setRName(""); }}
          className={btnPrimary}
        >
          {showForm ? t("srp.closeForm") : t("srp.addReport")}
        </button>
      </div>

      {msg && (
        <p className={`mt-3 rounded-lg px-4 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"}`}>
          {msg.text}
        </p>
      )}

      {showForm && (
        <form onSubmit={submit} className="mt-4 space-y-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {editId ? t("srp.editTitle") : t("srp.createTitle")}
          </h3>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className={label}>{t("srp.name")}</label>
              <input required value={rName} onChange={(e) => setRName(e.target.value)} placeholder={t("srp.phName")} className={`${input} mt-1 w-56`} />
            </div>
            <div>
              <label className={label}>{t("srp.type")}</label>
              <select value={rType} onChange={(e) => setRType(e.target.value)} className={`${input} mt-1`}>
                <option value="cost">{t("srp.typeCost")}</option>
                <option value="activity">{t("srp.typeActivity")}</option>
                <option value="backup">{t("srp.typeBackup")}</option>
              </select>
            </div>
            <div>
              <label className={label}>{t("srp.schedule")}</label>
              <select value={rSched} onChange={(e) => setRSched(e.target.value)} className={`${input} mt-1`}>
                <option value="daily">{t("srp.optDaily")}</option>
                <option value="weekly">{t("srp.optWeekly")}</option>
                <option value="monthly">{t("srp.optMonthly")}</option>
                <option value="cron">{t("srp.optCron")}</option>
              </select>
            </div>
            {rSched === "weekly" && (
              <div>
                <label className={label}>{t("srp.dayLabel")}</label>
                <select value={rDay} onChange={(e) => setRDay(Number(e.target.value))} className={`${input} mt-1`}>
                  {RPT_DAY_NAMES.map((d, i) => (
                    <option key={i} value={i}>{t(d)}</option>
                  ))}
                </select>
              </div>
            )}
            {rSched === "monthly" && (
              <div>
                <label className={label}>{t("srp.dateLabel")}</label>
                <select value={rDate} onChange={(e) => setRDate(Number(e.target.value))} className={`${input} mt-1`}>
                  {Array.from({ length: 28 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </div>
            )}
            {rSched === "cron" ? (
              <div>
                <label className={label}>{t("srp.cronHelp")}</label>
                <input value={rCron} onChange={(e) => setRCron(e.target.value)} placeholder={t("srp.phCron")} className={`${input} mt-1 w-40 font-mono`} />
              </div>
            ) : (
              <div>
                <label className={label}>{t("srp.timeLabel")}</label>
                <div className="mt-1"><TimeField value={rTime} onChange={setRTime} /></div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-[11px] text-slate-400 dark:text-slate-500">{t("srp.tzHint")}</p>
            <button disabled={busy} className={btnPrimary}>
              {busy ? t("srp.saving") : editId ? t("srp.update") : t("srp.save")}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="mt-4 space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <p className="mt-4 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
          {t("srp.empty")}
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {reports.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{r.name}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.enabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                    {r.enabled ? t("srp.enabledBadge") : t("srp.disabledBadge")}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {rptTypeLabel(r.type, t)} · {rptScheduleLabel(r, t)}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                  {t("srp.lastRun")}: {r.lastRunAt ? new Date(r.lastRunAt).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : t("srp.never")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => toggleEnabled(r)} title={r.enabled ? t("srp.disable") : t("srp.enable")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${r.enabled ? "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-950/60" : "bg-emerald-600 text-white shadow-sm hover:bg-emerald-500"}`}>
                  {r.enabled ? t("srp.disable") : t("srp.enable")}
                </button>
                <button onClick={() => startEdit(r)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
                  {t("srp.edit")}
                </button>
                <button onClick={() => remove(r)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100 dark:bg-red-950/50 dark:text-red-400 dark:hover:bg-red-950/70">
                  {t("srp.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FinancialReportPage() {
  const { t } = useLang();
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<AccountReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "credit" | "deposit" | "servers" | "perserver">("summary");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      const res = await fetch(`/api/reports/financial?${params}`);
      const d = await res.json();
      if (d.ok) setData(d.data ?? []);
      else setError(d.message ?? t("rep.errLoad"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    load();
  }, [load]);

  // Aggregate across all accounts
  const totalTopup = data.reduce((s, a) => s + (a.totals?.topup ?? 0), 0);
  const totalUsage = data.reduce((s, a) => s + (a.totals?.usage ?? 0), 0);
  const totalBalance = data.reduce((s, a) => s + (a.summary?.actual_balance ?? 0), 0);
  const totalServers = data.reduce((s, a) => s + (a.reportDetails?.length ?? 0), 0);
  const allCredit = data.flatMap((a) => (a.creditHistory ?? []).map((c) => ({ ...c, account: a.accountName })));
  const allDeposits = data.flatMap((a) => (a.deposits ?? []).map((d) => ({ ...d, account: a.accountName })));
  const allServerDetails = data.flatMap((a) => (a.reportDetails ?? []).map((r) => ({ ...r, account: a.accountName })));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{t("rep.title")}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("rep.subtitle")}</p>
      </div>

      {/* Filter */}
      <div className={`${card} flex flex-wrap items-end gap-4`}>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{t("rep.fromDate")}</label>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${input} mt-1`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{t("rep.toDate")}</label>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={`${input} mt-1`} />
        </div>
        <button onClick={load} disabled={loading} className={btnPrimary}>
          {loading ? t("rep.loading") : t("rep.show")}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      {data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className={card}>
            <p className="text-xs font-medium text-slate-400">{t("rep.balanceActual")}</p>
            <p className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{rupiah(totalBalance)}</p>
          </div>
          <div className={card}>
            <p className="text-xs font-medium text-slate-400">{t("rep.totalTopup")}</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{rupiah(totalTopup)}</p>
          </div>
          <div className={card}>
            <p className="text-xs font-medium text-slate-400">{t("rep.totalUsage")}</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{rupiah(totalUsage)}</p>
          </div>
          <div className={card}>
            <p className="text-xs font-medium text-slate-400">{t("rep.totalServers")}</p>
            <p className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{totalServers}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      {data.length > 0 && (
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {([["summary", t("rep.tabSummary")], ["credit", t("rep.tabCredit")], ["deposit", t("rep.tabDeposit")], ["servers", t("rep.tabServers")], ["perserver", t("rep.tabPerServer")]] as const).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${tab === k ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          ))}
        </div>
      )}

      {/* Tab: Summary */}
      {!loading && tab === "summary" && data.length > 0 && (
        <div className="space-y-4">
          {data.map((a) => (
            <div key={a.accountId} className={card}>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{a.accountName}</h3>
              {a.error ? (
                <p className="mt-2 text-xs text-red-500">{a.error}</p>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-slate-400">{t("rep.balance")}</p>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">{rupiah(a.summary?.actual_balance)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">{t("rep.monthCost")}</p>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">{rupiah(a.summary?.current_cost)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">{t("rep.estEndMonth")}</p>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">{rupiah(a.summary?.estimated_monthly_total)}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tab: Credit History */}
      {!loading && tab === "credit" && (
        <div className={card + " overflow-x-auto"}>
          {allCredit.length === 0 ? (
            <p className="p-5 text-center text-sm text-slate-400">{t("rep.emptyCredit")}</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className={th}>{t("rep.date")}</th>
                  <th className={th}>{t("rep.account")}</th>
                  <th className={th}>{t("rep.type")}</th>
                  <th className={th}>{t("rep.desc")}</th>
                  <th className={th + " text-right"}>{t("rep.amount")}</th>
                  <th className={th + " text-right"}>{t("rep.balanceRemaining")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {allCredit.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                    <td className={td}>{fmtDate(c.created_at)}</td>
                    <td className={td}>{c.account}</td>
                    <td className={td}>
                      <span className={c.type === "Deduct" ? "text-red-600" : "text-emerald-600"}>{c.type}</span>
                    </td>
                    <td className={td + " max-w-xs truncate"}>{c.description}</td>
                    <td className={td + " text-right font-mono"}>{c.amount}</td>
                    <td className={td + " text-right font-mono"}>{c.balance_after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab: Deposit History */}
      {!loading && tab === "deposit" && (
        <div className={card + " overflow-x-auto"}>
          {allDeposits.length === 0 ? (
            <p className="p-5 text-center text-sm text-slate-400">{t("rep.emptyDeposit")}</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className={th}>{t("rep.date")}</th>
                  <th className={th}>{t("rep.account")}</th>
                  <th className={th}>{t("rep.desc")}</th>
                  <th className={th}>{t("rep.method")}</th>
                  <th className={th}>{t("rep.status")}</th>
                  <th className={th + " text-right"}>{t("rep.amount")}</th>
                  <th className={th + " text-right"}>{t("rep.ppn")}</th>
                  <th className={th + " text-right"}>{t("rep.fee")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {allDeposits.map((d, i) => (
                  <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                    <td className={td}>{fmtDate(d.created_at)}</td>
                    <td className={td}>{d.account}</td>
                    <td className={td}>{d.description}</td>
                    <td className={td}>{d.method ?? "—"}</td>
                    <td className={td}>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${d.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className={td + " text-right font-mono"}>{rupiah(d.detail?.amount)}</td>
                    <td className={td + " text-right font-mono"}>{rupiah(d.detail?.vat)}</td>
                    <td className={td + " text-right font-mono"}>{rupiah(d.detail?.payment_fee)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab: Server Details */}
      {!loading && tab === "servers" && (
        <div className="space-y-4">
          {allServerDetails.length === 0 ? (
            <div className={card}>
              <p className="p-5 text-center text-sm text-slate-400">{t("rep.emptyServers")}</p>
            </div>
          ) : (
            allServerDetails.map((svc, i) => (
              <div key={i} className={card}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{svc.service}</h3>
                    <p className="text-xs text-slate-400">{svc.account}</p>
                  </div>
                  <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{rupiah(svc.total)}</p>
                </div>
                {svc.reports.map((r, j) => (
                  <div key={j} className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{r.service_name}</p>
                        {r.tier_name && <p className="text-xs text-slate-400">{r.tier_name}</p>}
                      </div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{rupiah(r.total_cost)}</p>
                    </div>
                    {r.details.length > 0 && (
                      <div className="mt-2 ml-4">
                        {r.details.map((d, k) => (
                          <div key={k} className="flex items-center justify-between py-0.5 text-xs text-slate-500 dark:text-slate-400">
                            <span>{d.name}</span>
                            <span className="font-mono">{d.total_uptime_hour.toFixed(1)} {t("rep.hoursUnit")} · {rupiah(d.total_cost)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Per Server */}
      {!loading && tab === "perserver" && (
        <div className="space-y-4">
          {(() => {
            // Group by server name across all service categories
            const serverMap = new Map<string, { account: string; components: { category: string; name: string; description: string; cost: number; uptime: number; basePrice: number }[]; totalCost: number }>();
            for (const svc of allServerDetails) {
              for (const r of svc.reports) {
                const key = `${r.service_name}|||${svc.account}`;
                const existing = serverMap.get(key);
                if (existing) {
                  for (const d of r.details) {
                    existing.components.push({ category: svc.service, ...d, cost: d.total_cost, uptime: d.total_uptime_hour, basePrice: d.base_price });
                    existing.totalCost += d.total_cost;
                  }
                } else {
                  const components = r.details.map((d) => ({ category: svc.service, ...d, cost: d.total_cost, uptime: d.total_uptime_hour, basePrice: d.base_price }));
                  serverMap.set(key, { account: svc.account, components, totalCost: components.reduce((s, c) => s + c.cost, 0) });
                }
              }
            }
            const servers = [...serverMap.entries()].map(([key, val]) => ({ name: key.split("|||")[0], ...val })).sort((a, b) => b.totalCost - a.totalCost);

            if (servers.length === 0) {
              return (
                <div className={card}>
                  <p className="p-5 text-center text-sm text-slate-400">{t("rep.emptyPerServer")}</p>
                </div>
              );
            }
            return (
              <>
                <div className={`${card} flex items-center justify-between`}>
                  <p className="text-sm text-slate-500">{servers.length} {t("rep.serversFound")}</p>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("rep.total")}: {rupiah(servers.reduce((s, sv) => s + sv.totalCost, 0))}</p>
                </div>
                {servers.map((sv, i) => (
                  <div key={i} className={card}>
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{sv.name}</h3>
                        <p className="text-xs text-slate-400">{sv.account}</p>
                      </div>
                      <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{rupiah(sv.totalCost)}</p>
                    </div>
                    <div className="mt-3 space-y-1">
                      {sv.components.map((c, j) => (
                        <div key={j} className="flex items-center justify-between py-1 text-xs text-slate-500 dark:text-slate-400">
                          <span>
                            <span className="inline-block w-20 rounded bg-slate-100 px-1.5 py-0.5 text-center text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">{c.category}</span>
                            {" "}
                            {c.name}
                            {c.description && c.description !== c.name && <span className="ml-1 text-slate-400">({c.description})</span>}
                          </span>
                          <span className="flex gap-3 font-mono">
                            {c.uptime > 0 && <span>{c.uptime.toFixed(0)} {t("rep.hoursUnit")}</span>}
                            {c.basePrice > 0 && <span className="text-slate-400">@ {rupiah(c.basePrice)}</span>}
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{rupiah(c.cost)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Per-component bar */}
                    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      {sv.components.filter((c) => c.cost > 0).map((c, j) => {
                        const pct = (c.cost / sv.totalCost) * 100;
                        const colors = ["bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500", "bg-rose-500", "bg-cyan-500"];
                        return <div key={j} className={`${colors[j % colors.length]} transition-all`} style={{ width: `${pct}%` }} title={`${c.name}: ${rupiah(c.cost)} (${pct.toFixed(1)}%)`} />;
                      })}
                    </div>
                  </div>
                ))}
              </>
            );
          })()}
        </div>
      )}

      {/* Empty state */}
      {!loading && data.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
          {t("rep.emptyAll")}
        </div>
      )}

      {/* Laporan Terjadwal */}
      <ScheduledReportSection />
    </div>
  );
}
