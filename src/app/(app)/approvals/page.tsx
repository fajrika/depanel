"use client";

import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Approval = {
  id: string;
  action: string;
  detail: string | null;
  status: string;
  requestedAt: string;
  resolvedAt: string | null;
  server: { hostname: string } | null;
  requestedBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
};

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btn =
  "rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50";

function fmtTime(s?: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const cls =
    status === "approved"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900"
      : status === "rejected"
        ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900"
        : status === "expired"
          ? "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"
          : "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:ring-amber-900";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${cls}`}>
      {status === "approved" ? `✓ ${t("apr.statusApproved")}` : status === "rejected" ? `✕ ${t("apr.statusRejected")}` : status === "expired" ? `· ${t("apr.statusExpired")}` : `● ${t("apr.statusPending")}`}
    </span>
  );
}

function ReinstallDetail({ detail, t }: { detail: string | null; t: (k: string) => string }) {
  if (!detail) return null;
  try {
    const d = JSON.parse(detail) as { template_id?: number; username?: string; password?: string };
    return (
      <span className="text-slate-500 dark:text-slate-400">
        {t("apr.template")} #{d.template_id ?? "—"} · {t("apr.user")} {d.username ?? "—"} {d.password ? "· ***" : ""}
      </span>
    );
  } catch {
    return <span className="text-slate-500 dark:text-slate-400">{detail}</span>;
  }
}

export default function ApprovalsPage() {
  const { t } = useLang();
  const [items, setItems] = useState<Approval[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/approvals");
      const d = await res.json();
      if (d.ok) {
        setItems(d.data.items ?? []);
        setCanManage(d.data.canManage ?? false);
        setMyId(d.data.myId ?? null);
      }
    } catch {
      /* biarkan data lama */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decide(a: Approval, decision: "approved" | "rejected") {
    const confirmMsg = decision === "approved" ? t("apr.confirmApprove") : t("apr.confirmReject");
    if (!confirm(confirmMsg)) return;
    setBusyId(a.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/approvals/${a.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const d = await res.json();
      if (d.ok) {
        setMsg({ text: decision === "approved" ? t("apr.approved") : t("apr.rejected"), ok: true });
      } else {
        setMsg({ text: d.message ?? (decision === "approved" ? t("apr.errApprove") : t("apr.errReject")), ok: false });
      }
    } catch {
      setMsg({ text: decision === "approved" ? t("apr.errApprove") : t("apr.errReject"), ok: false });
    } finally {
      setBusyId(null);
      load();
    }
  }

  async function remove(a: Approval) {
    if (!confirm(t("apr.confirmRemove"))) return;
    setBusyId(a.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/approvals/${a.id}`, { method: "DELETE" });
      const d = await res.json();
      setMsg({ text: d.ok ? t("apr.removed") : d.message ?? t("apr.errRemove"), ok: d.ok });
    } catch {
      setMsg({ text: t("apr.errRemove"), ok: false });
    } finally {
      setBusyId(null);
      load();
    }
  }

  const pending = items.filter((i) => i.status === "pending");
  const history = items.filter((i) => i.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">🛡️ {t("apr.title")}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("apr.subtitle")}</p>
      </div>

      {msg && (
        <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300" : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"}`}>
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{t("apr.pending")} ({pending.length})</h2>
        {loading ? (
          <div className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
        ) : pending.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">{t("apr.emptyPending")}</p>
        ) : (
          pending.map((a) => (
            <div key={a.id} className={`${card} animate-fade-up`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${a.action === "delete" ? "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400" : "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"}`}>
                  {a.action === "delete" ? `🗑️ ${t("apr.actionDelete")}` : `🔄 ${t("apr.actionReinstall")}`}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{a.server?.hostname ?? a.detail ?? "—"}</span>
                  <span className="ml-2">{a.action === "reinstall" && <ReinstallDetail detail={a.detail} t={t} />}</span>
                </span>
                <StatusBadge status={a.status} t={t} />
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {t("apr.requestedBy")}: <b>{a.requestedBy.name}</b> · {t("apr.requestedAt")}: {fmtTime(a.requestedAt)}
              </p>
              {canManage && a.requestedBy.id !== myId ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={busyId === a.id} onClick={() => decide(a, "approved")} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}>
                    {busyId === a.id ? t("apr.processing") : t("apr.approveBtn")}
                  </button>
                  <button disabled={busyId === a.id} onClick={() => decide(a, "rejected")} className={`${btn} bg-red-600 text-white hover:bg-red-500`}>
                    {t("apr.rejectBtn")}
                  </button>
                  <button disabled={busyId === a.id} onClick={() => remove(a)} className={`${btn} text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800`}>
                    {t("apr.cancelBtn")}
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{t("apr.selfNote")}</p>
              )}
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{t("apr.history")} ({history.length})</h2>
        {history.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">{t("apr.emptyHistory")}</p>
        ) : (
          <div className="space-y-2">
            {history.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                <span className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${a.action === "delete" ? "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400" : "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"}`}>
                  {a.action === "delete" ? t("apr.actionDelete") : t("apr.actionReinstall")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{a.server?.hostname ?? a.detail ?? "—"}</span>
                  {a.action === "reinstall" && a.status === "approved" && (
                    <span className="ml-2"><ReinstallDetail detail={a.detail} t={t} /></span>
                  )}
                </span>
                <StatusBadge status={a.status} t={t} />
                <span className="text-xs text-slate-400">
                  {a.requestedBy.name} → {a.approvedBy?.name ?? "—"} · {fmtTime(a.resolvedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
