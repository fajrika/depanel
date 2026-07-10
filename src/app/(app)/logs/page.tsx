"use client";

import { useEffect, useState } from "react";

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
      <h1 className="text-xl font-semibold">Log aktivitas</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">Riwayat aksi manual (web) & otomatis (scheduler).</p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {loading ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Memuat…</p>
        ) : logs.length === 0 ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Belum ada aktivitas.</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Waktu</th>
                <th className="px-4 py-2 font-medium">Aksi</th>
                <th className="px-4 py-2 font-medium">Sumber</th>
                <th className="px-4 py-2 font-medium">Oleh</th>
                <th className="px-4 py-2 font-medium">Server</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Pesan</th>
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
