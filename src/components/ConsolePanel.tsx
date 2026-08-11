"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n";

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

/** Find a password field in the response (depa returns it alongside the ws URL). */
function findPassword(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const d = obj as Record<string, unknown>;
  if (typeof d.password === "string") return d.password as string;
  if (d.data && typeof d.data === "object") return findPassword(d.data);
  return null;
}

export default function ConsolePanel({ serverId, hostname }: { serverId: string; hostname: string }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setErr(null);
    setInfo(null);
    const res = await fetch(`/api/servers/${serverId}/console`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !d.ok) {
      setErr(d.message ?? t("cons.errOpen"));
      return;
    }

    const wsUrl = findUrl(d.data);
    const password = findPassword(d.data);

    if (!wsUrl) {
      setErr(t("cons.errNoWs"));
      setInfo(JSON.stringify(d.data, null, 2));
      return;
    }

    // Open the noVNC viewer page with base64-encoded params
    const params = new URLSearchParams({
      ws: btoa(wsUrl),
      password: btoa(password ?? ""),
    });
    window.open(`/console.html?${params.toString()}`, "_blank", "noopener,noreferrer");
    setInfo(t("cons.opened"));
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("cons.title")} — {hostname}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t("cons.subtitle")}
        </p>
        <button
          onClick={open}
          disabled={busy}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {busy ? t("cons.opening") : t("cons.openBtn")}
        </button>

        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</p>}

        {info && (
          <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/50 dark:text-green-300">{info}</p>
        )}
      </div>
    </div>
  );
}
