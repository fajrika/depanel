"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";

type Props = {
  sshId: string;
  name: string;
  host: string;
  username: string;
  port: number;
  onClose: () => void;
};

export default function SshTerminal({ sshId, name, host, username, port, onClose }: Props) {
  const { t } = useLang();
  const termRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const termInstanceRef = useRef<import("xterm").Terminal | null>(null);

  useEffect(() => {
    let disposed = false;
    let wsUrl = "";

    async function init() {
      // Fetch WS URL from server (runtime config, not build-time)
      try {
        const res = await fetch("/api/config/ssh-ws");
        const d = await res.json();
        wsUrl = d.url || "";
      } catch {
        wsUrl = "";
      }

      const { Terminal } = await import("xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      await import("xterm/css/xterm.css");

      if (disposed || !termRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        theme: {
          background: "#0f172a",
          foreground: "#e2e8f0",
          cursor: "#38bdf8",
          cursorAccent: "#0f172a",
          selectionBackground: "#334155",
          black: "#0f172a",
          red: "#f87171",
          green: "#34d399",
          yellow: "#fbbf24",
          blue: "#60a5fa",
          magenta: "#c084fc",
          cyan: "#22d3ee",
          white: "#e2e8f0",
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      term.open(termRef.current);
      fitAddon.fit();
      termInstanceRef.current = term;

      const baseWsUrl = wsUrl || `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.hostname}:3001`;
      const ws = new WebSocket(`${baseWsUrl}?sshId=${sshId}`);
      wsRef.current = ws;

      ws.onopen = () => setStatus("connecting");

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "connected") {
            setStatus("connected");
            fitAddon.fit();
            term.focus();
          } else if (msg.type === "output") {
            term.write(msg.data);
          } else if (msg.type === "error") {
            setStatus("error");
            setErrorMsg(msg.message);
          } else if (msg.type === "disconnected") {
            setStatus("disconnected");
          }
        } catch {
          term.write(ev.data);
        }
      };

      ws.onerror = () => {
        if (!disposed) {
          setStatus("error");
          setErrorMsg(t("ssht.wsErr"));
        }
      };

      ws.onclose = () => {
        if (!disposed) setStatus((s) => (s === "connected" ? "disconnected" : s));
      };

      // WS → SSH input
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      // Resize
      const ro = new ResizeObserver(() => {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      });
      ro.observe(termRef.current);

      // Initial resize
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });

      return () => { ro.disconnect(); };
    }

    init();

    return () => {
      disposed = true;
      wsRef.current?.close();
      termInstanceRef.current?.dispose();
    };
  }, [sshId]);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-[#0f172a] shadow-sm dark:border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${status === "connected" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400 animate-pulse" : status === "error" ? "bg-red-400" : "bg-slate-400"}`} />
          <span className="text-sm font-medium text-slate-200">{name}</span>
          <span className="text-xs text-slate-500">{username}@{host}:{port}</span>
        </div>
        <button onClick={onClose} className="rounded-lg px-2.5 py-1 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-slate-200">{t("ssht.close")}</button>
      </div>

      {/* Terminal */}
      <div className="relative flex-1 overflow-hidden p-1">
        <div ref={termRef} className="h-full w-full" />
        {status === "error" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0f172a]/70">
            <div className="rounded-xl bg-red-600 px-6 py-4 text-center shadow-lg">
              <p className="mb-2 text-sm font-semibold text-white">{t("ssht.connFail")}</p>
              <p className="mb-3 max-w-md text-xs text-red-100">{errorMsg}</p>
              <button onClick={onClose} className="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/30">{t("ssht.closeBtn")}</button>
            </div>
          </div>
        )}
        {status === "disconnected" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0f172a]/70">
            <div className="rounded-xl bg-red-600 px-6 py-4 text-center shadow-lg">
              <p className="mb-2 text-sm font-semibold text-white">{t("ssht.disconnected")}</p>
              <p className="mb-3 text-xs text-red-100">{t("ssht.discHint")}</p>
              <button onClick={onClose} className="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/30">{t("ssht.closeBtn")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
