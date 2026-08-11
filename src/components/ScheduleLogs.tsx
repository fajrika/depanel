"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type LogEntry = {
  id: string;
  action: string;
  source: string;
  status: string;
  message: string | null;
  createdAt: string;
  user: { name: string | null; email: string } | null;
};

const ACTION_LABELS: Record<string, string> = {
  start: "▶ Nyalakan",
  stop: "■ Matikan",
  restart: "↻ Restart",
  "schedule-update": "🕒 Update Jadwal",
  "reconcile-now": "⚙ Reconcile",
  sync: "🔄 Sync",
};

export default function ScheduleLogs({ serverId }: { serverId: string }) {
  const { t } = useLang();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/servers/${serverId}/schedule/logs?limit=30`)
      .then((r) => r.json())
      .then((d) => setLogs(d.data ?? []))
      .finally(() => setLoading(false));
  }, [serverId]);

  if (loading) {
    return <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("schl.title")}</h3>
      {logs.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">{t("schl.empty")}</p>
      ) : (
        <div className="mt-3 space-y-1.5 max-h-[480px] overflow-y-auto">
          {logs.map((l) => (
            <div key={l.id} className="flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${l.status === "success" ? "bg-emerald-500" : "bg-red-500"}`} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-700 dark:text-slate-200">
                  {ACTION_LABELS[l.action] ? t(`schl.action.${l.action}`) : l.action}
                  {l.source === "scheduler" && <span className="ml-1 text-[10px] text-slate-400">{t("schl.auto")}</span>}
                </p>
                {l.message && <p className="mt-0.5 text-slate-400 dark:text-slate-500 truncate">{l.message}</p>}
              </div>
              <span className="shrink-0 text-slate-400 dark:text-slate-500">
                {new Date(l.createdAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
