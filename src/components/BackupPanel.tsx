"use client";

import { useCallback, useEffect, useState } from "react";

type Snapshot = {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
  current_hourly_price?: number;
  current_cost?: number;
  is_current_state?: boolean;
  created_at?: string;
};

type BackupSchedule = Record<string, unknown> & {
  id?: string;
  uuid?: string;
  retention?: number;
  schedule_type?: string;
  schedule_at?: number;
  schedule_on?: number;
};

type BackupFile = Record<string, unknown> & {
  id?: string;
  uuid?: string;
  backup_uuid?: string;
  name?: string;
  size?: string | number;
  status?: string;
  created_at?: string;
};

const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

function rupiah(n?: number): string {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
}

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btnSm =
  "rounded-lg px-2.5 py-1 text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed";

export default function BackupPanel({ serverId, hostname }: { serverId: string; hostname: string }) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [schedules, setSchedules] = useState<BackupSchedule[] | null>(null);
  const [history, setHistory] = useState<BackupFile[]>([]);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const [snapName, setSnapName] = useState("");
  const [bkType, setBkType] = useState<"daily" | "weekly">("daily");
  const [bkHour, setBkHour] = useState(2);
  const [bkDay, setBkDay] = useState(0);
  const [bkRetention, setBkRetention] = useState(3);

  const load = useCallback(async () => {
    const [sRes, bRes] = await Promise.all([
      fetch(`/api/servers/${serverId}/snapshots`),
      fetch(`/api/servers/${serverId}/backups`),
    ]);
    const s = await sRes.json();
    const b = await bRes.json();
    if (s.ok) setSnapshots(Array.isArray(s.data) ? s.data : []);
    else setMsg({ text: s.message, ok: false });
    if (b.ok) {
      setSchedules(Array.isArray(b.data.schedules) ? b.data.schedules : []);
      const h = b.data.history;
      const items = Array.isArray(h) ? h : Array.isArray(h?.data) ? h.data : Array.isArray(h?.data?.data) ? h.data.data : [];
      setHistory(items);
    }
  }, [serverId]);

  useEffect(() => {
    setSnapshots(null);
    setSchedules(null);
    setMsg(null);
    load();
  }, [load]);

  async function api(path: string, method: string, body?: unknown, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(d.ok ? { text: typeof d.data?.message === "string" ? d.data.message : "Berhasil.", ok: true } : { text: d.message ?? "Gagal", ok: false });
    load();
  }

  return (
    <div className="animate-fade-up space-y-5">
      {msg && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            msg.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
          }`}
        >
          {msg.text}
        </p>
      )}

      {/* ===== Snapshot ===== */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Snapshot</h3>
            <p className="text-xs text-slate-400">Salinan penuh kondisi server saat ini (berbayar per jam oleh depa).</p>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              api(
                `/api/servers/${serverId}/snapshots`,
                "POST",
                { name: snapName, description: `Snapshot ${hostname}` },
                `Buat snapshot "${snapName}"? Snapshot dikenai biaya per jam oleh depa.`,
              ).then(() => setSnapName(""));
            }}
          >
            <input
              required
              value={snapName}
              onChange={(e) => setSnapName(e.target.value)}
              placeholder="nama snapshot…"
              className="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              disabled={busy}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            >
              + Buat
            </button>
          </form>
        </div>

        <div className="mt-4 space-y-2">
          {snapshots === null ? (
            <div className="h-14 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ) : snapshots.length === 0 ? (
            <p className="text-xs text-slate-400">Belum ada snapshot.</p>
          ) : (
            snapshots.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    {s.name}{" "}
                    <span className={`text-xs ${s.status === "Available" ? "text-emerald-600" : "text-amber-600"}`}>
                      · {s.status}
                    </span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {s.created_at} · biaya {rupiah(s.current_hourly_price)}/jam · total {rupiah(s.current_cost)}
                  </p>
                </div>
                <button
                  onClick={() =>
                    api(
                      `/api/servers/${serverId}/snapshots/${s.id}`,
                      "PATCH",
                      undefined,
                      `ROLLBACK ${hostname} ke snapshot "${s.name}"?\n\nSemua perubahan setelah snapshot itu akan HILANG. Lanjutkan?`,
                    )
                  }
                  disabled={busy}
                  className={`${btnSm} border border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/40`}
                >
                  ⟲ Rollback
                </button>
                <button
                  onClick={() =>
                    api(
                      `/api/servers/${serverId}/snapshots/${s.id}`,
                      "DELETE",
                      undefined,
                      `Hapus snapshot "${s.name}"? Tidak bisa dibatalkan.`,
                    )
                  }
                  disabled={busy}
                  className={`${btnSm} text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40`}
                >
                  Hapus
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ===== Backup otomatis depa ===== */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Backup otomatis (depa)</h3>
        <p className="text-xs text-slate-400">Depa membuat arsip backup terjadwal; arsip bisa di-restore kapan saja.</p>

        <div className="mt-4 space-y-2">
          {schedules === null ? (
            <div className="h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ) : schedules.length === 0 ? (
            <form
              className="flex flex-wrap items-end gap-3 rounded-xl border-2 border-dashed border-slate-200 p-4 dark:border-slate-700"
              onSubmit={(e) => {
                e.preventDefault();
                api(`/api/servers/${serverId}/backups`, "POST", {
                  retention: bkRetention,
                  schedule_type: bkType,
                  schedule_at: bkHour,
                  ...(bkType === "weekly" ? { schedule_on: bkDay } : {}),
                });
              }}
            >
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">Frekuensi</label>
                <select
                  value={bkType}
                  onChange={(e) => setBkType(e.target.value as "daily" | "weekly")}
                  className="mt-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="daily">Harian</option>
                  <option value="weekly">Mingguan</option>
                </select>
              </div>
              {bkType === "weekly" && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">Hari</label>
                  <select
                    value={bkDay}
                    onChange={(e) => setBkDay(Number(e.target.value))}
                    className="mt-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {DAY_NAMES.map((d, i) => (
                      <option key={i} value={i}>{d}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">Jam</label>
                <select
                  value={bkHour}
                  onChange={(e) => setBkHour(Number(e.target.value))}
                  className="mt-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs tabular-nums dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">Simpan (versi)</label>
                <select
                  value={bkRetention}
                  onChange={(e) => setBkRetention(Number(e.target.value))}
                  className="mt-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  {[1, 2, 3, 5, 7, 14].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <button
                disabled={busy}
                className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
              >
                Aktifkan backup
              </button>
            </form>
          ) : (
            schedules.map((sc, i) => {
              const sid = String(sc.id ?? sc.uuid ?? "");
              return (
                <div
                  key={sid || i}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40"
                >
                  <div className="flex-1 text-sm text-slate-800 dark:text-slate-100">
                    {sc.schedule_type === "weekly"
                      ? `Mingguan, ${DAY_NAMES[Number(sc.schedule_on ?? 0) % 7]} `
                      : "Harian, "}
                    jam {String(sc.schedule_at ?? 0).padStart(2, "0")}:00
                    <span className="ml-2 text-xs text-slate-400">retensi {String(sc.retention ?? "?")} versi</span>
                  </div>
                  {sid && (
                    <button
                      onClick={() =>
                        api(
                          `/api/servers/${serverId}/backups/schedules/${sid}`,
                          "DELETE",
                          undefined,
                          "Hapus jadwal backup otomatis ini?",
                        )
                      }
                      disabled={busy}
                      className={`${btnSm} text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40`}
                    >
                      Hapus
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* history */}
        <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Arsip backup</h4>
        <div className="mt-2 space-y-2">
          {history.length === 0 ? (
            <p className="text-xs text-slate-400">Belum ada arsip backup.</p>
          ) : (
            history.map((b, i) => {
              const bid = String(b.id ?? b.uuid ?? b.backup_uuid ?? "");
              return (
                <div
                  key={bid || i}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {String(b.name ?? bid ?? `backup #${i + 1}`)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {String(b.created_at ?? "")} {b.size !== undefined ? `· ${b.size}` : ""}{" "}
                      {b.status !== undefined ? `· ${b.status}` : ""}
                    </p>
                  </div>
                  {bid && (
                    <>
                      <button
                        onClick={() =>
                          api(
                            `/api/servers/${serverId}/backups/${bid}`,
                            "POST",
                            undefined,
                            `RESTORE ${hostname} dari arsip ini?\n\nIsi server akan dikembalikan ke kondisi backup. Lanjutkan?`,
                          )
                        }
                        disabled={busy}
                        className={`${btnSm} border border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/40`}
                      >
                        ⟲ Restore
                      </button>
                      <button
                        onClick={() =>
                          api(`/api/servers/${serverId}/backups/${bid}`, "DELETE", undefined, "Hapus arsip backup ini?")
                        }
                        disabled={busy}
                        className={`${btnSm} text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40`}
                      >
                        Hapus
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
