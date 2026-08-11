"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Log = {
  id: string;
  action: string;
  source: string;
  status: string;
  message: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
  server: { hostname: string } | null;
};

export default function LogsPage() {
  const { t } = useLang();
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/logs")
      .then((r) => r.json())
      .then((d) => setLogs(d.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-xl font-semibold">{t("logs.title")}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">{t("logs.subtitle")}</p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {loading ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">{t("logs.loading")}</p>
        ) : logs.length === 0 ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">{t("logs.empty")}</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">{t("logs.time")}</th>
                <th className="px-4 py-2 font-medium">{t("logs.action")}</th>
                <th className="px-4 py-2 font-medium">{t("logs.source")}</th>
                <th className="px-4 py-2 font-medium">{t("logs.by")}</th>
                <th className="px-4 py-2 font-medium">{t("logs.server")}</th>
                <th className="px-4 py-2 font-medium">{t("logs.status")}</th>
                <th className="px-4 py-2 font-medium">{t("logs.message")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800 align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500 dark:text-slate-400">
                    {new Date(l.createdAt).toLocaleString("id-ID")}
                  </td>
                  <td className="px-4 py-2 font-medium">{l.action}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${l.source === "scheduler" ? "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"}`}>
                      {l.source}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{l.user?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{l.server?.hostname ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={l.status === "success" ? "text-green-600" : "text-red-600"}>{l.status}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
