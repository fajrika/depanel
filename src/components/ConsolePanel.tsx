"use client";

import { useState } from "react";

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";

/** Pull a console-websocket session from depa and surface the connection URL. */
function findUrl(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const d = obj as Record<string, unknown>;
  for (const k of ["url", "ws_url", "console_url", "link", "websocket", "wss"]) {
    if (typeof d[k] === "string") return d[k] as string;
  }
  // nested data
  if (d.data && typeof d.data === "object") return findUrl(d.data);
  return null;
}

export default function ConsolePanel({ serverId, hostname }: { serverId: string; hostname: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string | null; raw: unknown } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setErr(null);
    setResult(null);
    const res = await fetch(`/api/servers/${serverId}/console`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !d.ok) {
      setErr(d.message ?? "Gagal membuka console");
      return;
    }
    setResult({ url: findUrl(d.data), raw: d.data });
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Web console — {hostname}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Buka sesi console (VNC/serial) langsung ke server via depa. Berguna saat SSH mati tapi server masih hidup.
        </p>
        <button
          onClick={open}
          disabled={busy}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {busy ? "Membuka…" : "🖥️ Buka console"}
        </button>

        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</p>}

        {result && (
          <div className="mt-4">
            {result.url ? (
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
              >
                ↗ Buka console di tab baru
              </a>
            ) : (
              <>
                <p className="text-xs text-slate-500 dark:text-slate-400">Sesi dibuat. Detail koneksi dari depa:</p>
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">{JSON.stringify(result.raw, null, 2)}</pre>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
