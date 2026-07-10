"use client";

import { useCallback, useEffect, useState } from "react";
import ServerMonitor, { type PanelTab } from "@/components/ServerMonitor";

type Server = {
  id: string;
  uuid: string;
  hostname: string;
  status: string;
  location: string | null;
  tier: string | null;
  ipAddress: string | null;
  cpu: number | null;
  memoryMb: number | null;
  storageGb: number | null;
  managed: boolean;
  isProduction: boolean;
  lastSyncedAt: string | null;
  account: { id: string; name: string };
  scheduleEnabled: boolean;
  actionCount: number;
  desiredState: "running" | "stopped" | null;
};

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const on = s === "running";
  const off = s === "stopped";
  const dot = on ? "bg-emerald-500" : off ? "bg-slate-400" : "bg-amber-500 animate-pulse";
  const cls = on
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900"
    : off
      ? "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"
      : "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:ring-amber-900";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

export default function Dashboard() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [isStaff, setIsStaff] = useState(false); // owner/admin tim aktif
  const [canSchedule, setCanSchedule] = useState(true);
  const [canBackup, setCanBackup] = useState(true);
  const [teamName, setTeamName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("monitoring");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleGroup(name: string) {
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  }

  const load = useCallback(async () => {
    const res = await fetch("/api/servers");
    if (res.ok) {
      const d = await res.json();
      setServers(d.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const role = d?.activeTeam?.role;
        setIsStaff(role === "owner" || role === "admin");
        setCanSchedule(d?.activeTeam?.canSchedule ?? true);
        setCanBackup(d?.activeTeam?.canBackup ?? true);
        setTeamName(d?.activeTeam?.name ?? "");
      })
      .catch(() => {});
  }, [load]);

  function selectServer(id: string, tab: PanelTab = "monitoring") {
    if (selectedId === id && tab === panelTab) {
      // klik ulang server yang sedang dipantau → tutup panel
      setSelectedId(null);
      return;
    }
    setPanelTab(tab);
    setSelectedId(id);
    // di HP panel menggantikan daftar — pastikan mulai dari atas
    if (window.innerWidth < 1024) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function power(s: Server, action: "start" | "stop" | "restart") {
    if (action === "stop" && s.isProduction && !confirm(`${s.hostname} ditandai PRODUCTION. Yakin matikan manual?`)) return;
    setBusy(s.id + action);
    setMsg(null);
    const res = await fetch(`/api/servers/${s.id}/power`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const d = await res.json();
    setBusy(null);
    setMsg(d.ok ? { text: `${s.hostname}: ${action} berhasil`, ok: true } : { text: `${s.hostname}: ${d.message}`, ok: false });
    load();
  }

  async function toggle(s: Server, field: "managed" | "isProduction") {
    setBusy(s.id + field);
    await fetch(`/api/servers/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: !s[field] }),
    });
    setBusy(null);
    load();
  }

  async function reorder(s: Server, dir: -1 | 1) {
    // tukar posisi dengan tetangga terdekat dalam akun yang sama, lalu simpan urutan penuh
    const next = [...servers];
    const idx = next.findIndex((x) => x.id === s.id);
    let ti = -1;
    for (let j = idx + dir; j >= 0 && j < next.length; j += dir) {
      if (next[j].account.id === s.account.id) {
        ti = j;
        break;
      }
    }
    if (ti === -1) return;
    [next[idx], next[ti]] = [next[ti], next[idx]];
    setServers(next);
    setBusy("reorder");
    await fetch("/api/servers/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: next.map((x) => x.id) }),
    });
    setBusy(null);
    load();
  }

  async function syncAll() {
    setBusy("sync-all");
    setMsg(null);
    const res = await fetch("/api/sync-all", { method: "POST" });
    const d = await res.json();
    setBusy(null);
    if (d.ok) {
      const total = d.data.reduce((n: number, r: { synced?: number }) => n + (r.synced ?? 0), 0);
      const failed = d.data.filter((r: { ok: boolean }) => !r.ok);
      setMsg({
        text:
          `Sync selesai — ${total} server dari ${d.data.length} akun.` +
          (failed.length ? ` Gagal: ${failed.map((r: { accountName: string }) => r.accountName).join(", ")}` : ""),
        ok: failed.length === 0,
      });
    } else {
      setMsg({ text: `Sync gagal: ${d.message}`, ok: false });
    }
    load();
  }

  const groups = servers.reduce<Record<string, Server[]>>((acc, s) => {
    (acc[s.account.name] ??= []).push(s);
    return acc;
  }, {});

  const running = servers.filter((s) => s.status === "running").length;
  const selected = servers.find((s) => s.id === selectedId) ?? null;

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Server</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {loading ? "Memuat…" : `${teamName ? teamName + " · " : ""}${servers.length} server · ${running} menyala`}
          </p>
        </div>
        <button
          onClick={syncAll}
          disabled={!!busy}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 ${busy === "sync-all" ? "animate-spin" : ""}`} fill="currentColor">
            <path d="M8 3a5 5 0 1 0 4.546 2.914.75.75 0 0 1 1.364-.626A6.5 6.5 0 1 1 8 1.5v-1a.25.25 0 0 1 .41-.192l2.36 1.966a.25.25 0 0 1 0 .384L8.41 4.624A.25.25 0 0 1 8 4.432V3Z" />
          </svg>
          {busy === "sync-all" ? "Menyinkronkan…" : "Sync depa"}
        </button>
      </div>

      {/* Flash message */}
      {msg && (
        <div
          className={`mb-5 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
            msg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
          }`}
        >
          <span className="mt-0.5">{msg.ok ? "✓" : "✕"}</span>
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {loading ? (
        <div className="flex gap-6">
          <div className="w-full space-y-4 lg:w-[400px]">
            {[0, 1].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
            ))}
          </div>
          <div className="hidden flex-1 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block" />
        </div>
      ) : servers.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-10 text-center dark:border-slate-700 dark:bg-slate-900/50">
          <p className="text-3xl">🖥️</p>
          <p className="mt-2 font-medium text-slate-700 dark:text-slate-200">Belum ada server</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Tambahkan API key depa di menu <b>Akun API</b>, lalu klik <b>Sync depa</b>.
          </p>
        </div>
      ) : (
        /* ===== 2 panel tetap: kiri list, kanan monitoring ===== */
        <div className="flex flex-col items-start gap-6 lg:flex-row">
          {/* KIRI — daftar server (di HP disembunyikan saat panel terbuka) */}
          <div className={`w-full shrink-0 lg:w-[400px] ${selected ? "hidden lg:block" : ""}`}>
            {Object.entries(groups).map(([account, list]) => {
              const isCollapsed = collapsed.has(account);
              const groupRunning = list.filter((s) => s.status === "running").length;
              return (
              <section key={account} className="mb-5">
                <button
                  onClick={() => toggleGroup(account)}
                  className="mb-3 flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-600"
                >
                  <span className={`text-slate-400 transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`}>▾</span>
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
                    {account.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{account}</span>
                  <span className="ml-auto text-[11px] text-slate-400 dark:text-slate-500">
                    {list.length} server · {groupRunning} menyala
                  </span>
                </button>
                <div className={`space-y-4 overflow-hidden transition-all duration-300 ${isCollapsed ? "max-h-0 opacity-0" : "max-h-[4000px] opacity-100"}`}>
                  {list.map((s, i) => {
                    const active = selectedId === s.id;
                    const isRunning = s.status === "running";
                    const isStopped = s.status === "stopped";
                    const controllable = s.managed;
                    return (
                      <div
                        key={s.id}
                        onClick={() => selectServer(s.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && selectServer(s.id)}
                        className={`animate-fade-up group cursor-pointer rounded-2xl border bg-white p-4 transition-all duration-300 dark:bg-slate-900 ${
                          active
                            ? "-translate-y-0.5 border-indigo-400 shadow-lg shadow-indigo-100 ring-2 ring-indigo-300 dark:border-indigo-500 dark:shadow-indigo-950 dark:ring-indigo-700"
                            : "border-slate-200 shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:hover:border-slate-600"
                        }`}
                        style={{ animationDelay: `${i * 60}ms` }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-[15px] font-semibold text-slate-900 dark:text-slate-100">{s.hostname}</span>
                              <StatusBadge status={s.status} />
                              {s.isProduction && (
                                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-red-200 dark:bg-red-950/60 dark:text-red-400 dark:ring-red-900">
                                  prod
                                </span>
                              )}
                            </div>
                            <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                              {[s.ipAddress, s.location].filter(Boolean).join(" · ") || s.uuid}
                            </p>
                          </div>
                          {isStaff && (
                            <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <div className="mr-0.5 flex flex-col">
                                <button
                                  onClick={() => reorder(s, -1)}
                                  disabled={!!busy || i === 0}
                                  title="Naikkan urutan"
                                  className="flex h-4 w-5 items-center justify-center rounded text-[9px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-20 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                                >
                                  ▲
                                </button>
                                <button
                                  onClick={() => reorder(s, 1)}
                                  disabled={!!busy || i === list.length - 1}
                                  title="Turunkan urutan"
                                  className="flex h-4 w-5 items-center justify-center rounded text-[9px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-20 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                                >
                                  ▼
                                </button>
                              </div>
                              <span className={`text-[11px] ${s.managed ? "font-medium text-emerald-600" : "text-slate-400 dark:text-slate-500"}`}>
                                {s.managed ? "Dikelola" : "Manual"}
                              </span>
                              <Toggle checked={s.managed} disabled={!!busy} onChange={() => toggle(s, "managed")} label={`Kelola ${s.hostname}`} />
                            </div>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => power(s, "start")}
                            disabled={!controllable || isRunning || !!busy}
                            title={!controllable ? "Aktifkan 'Dikelola' dulu" : isRunning ? "Server sudah menyala" : "Nyalakan server"}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
                          >
                            {busy === s.id + "start" ? "…" : "▶ Start"}
                          </button>
                          <button
                            onClick={() => power(s, "stop")}
                            disabled={!controllable || isStopped || !!busy}
                            title={!controllable ? "Aktifkan 'Dikelola' dulu" : isStopped ? "Server sudah mati" : "Matikan server"}
                            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:bg-slate-700 dark:hover:bg-slate-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
                          >
                            {busy === s.id + "stop" ? "…" : "■ Stop"}
                          </button>
                          <button
                            onClick={() => power(s, "restart")}
                            disabled={!controllable || isStopped || !!busy}
                            title={!controllable ? "Aktifkan 'Dikelola' dulu" : isStopped ? "Server sedang mati" : "Restart server"}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:disabled:border-slate-700 dark:disabled:text-slate-600"
                          >
                            {busy === s.id + "restart" ? "…" : "↻ Restart"}
                          </button>
                          <button
                            onClick={() => selectServer(s.id, "jadwal")}
                            disabled={!canSchedule}
                            title={canSchedule ? "Atur jadwal nyala-mati" : "Anda tidak diberi izin mengatur jadwal"}
                            className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            🕒{s.scheduleEnabled && s.actionCount > 0 && (
                              <span className="ml-1 rounded-full bg-indigo-100 px-1.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
                                {s.actionCount}
                              </span>
                            )}
                          </button>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-2.5 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
                          {isStaff ? (
                            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                              <input
                                type="checkbox"
                                checked={s.isProduction}
                                disabled={!!busy}
                                onChange={() => toggle(s, "isProduction")}
                                className="h-3 w-3 accent-red-600"
                              />
                              Production (anti auto-stop)
                            </label>
                          ) : s.isProduction ? (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">production — anti auto-stop</span>
                          ) : null}
                          {s.scheduleEnabled && s.desiredState && (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">
                              jadwal:{" "}
                              <b className={s.desiredState === "running" ? "text-emerald-600" : "text-slate-500 dark:text-slate-400"}>
                                {s.desiredState === "running" ? "nyala" : "mati"}
                              </b>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
              );
            })}
          </div>

          {/* KANAN — panel monitoring / placeholder */}
          <div className="w-full min-w-0 flex-1">
            {selected ? (
              <div key={selected.id} className="animate-slide-in-right">
                <button
                  onClick={() => setSelectedId(null)}
                  className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
                >
                  ← daftar server
                </button>
                <ServerMonitor
                  serverId={selected.id}
                  managed={selected.managed}
                  initialTab={panelTab}
                  canSchedule={canSchedule}
                  canBackup={canBackup}
                  onClose={() => setSelectedId(null)}
                  onScheduleSaved={load}
                />
              </div>
            ) : (
              /* placeholder hanya untuk desktop — di HP daftar server sudah memenuhi layar */
              <div className="animate-fade-up hidden min-h-[360px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-10 text-center dark:border-slate-700 dark:bg-slate-900/40 lg:flex">
                <p className="text-4xl">📡</p>
                <p className="mt-3 font-medium text-slate-700 dark:text-slate-200">Belum ada server yang dipantau</p>
                <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                  Silakan pilih salah satu server di sebelah kiri untuk melihat monitoring, jadwal, dan backup-nya.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
