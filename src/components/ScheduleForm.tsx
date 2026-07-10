"use client";

import { useEffect, useState } from "react";
import TimeField from "@/components/TimeField";

type ActionRow = { days: string; time: string; action: "start" | "stop" };

const DAYS = [
  { v: "1", l: "Sen" },
  { v: "2", l: "Sel" },
  { v: "3", l: "Rab" },
  { v: "4", l: "Kam" },
  { v: "5", l: "Jum" },
  { v: "6", l: "Sab" },
  { v: "0", l: "Min" },
];

export default function ScheduleForm({
  serverId,
  managed,
  onSaved,
}: {
  serverId: string;
  managed: boolean;
  onSaved?: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [timezone, setTimezone] = useState("Asia/Jakarta");
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/servers/${serverId}/schedule`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.data) {
          setEnabled(d.data.enabled ?? false);
          setTimezone(d.data.timezone ?? "Asia/Jakarta");
          setActions(
            (d.data.actions ?? []).map((a: ActionRow) => ({ days: a.days, time: a.time, action: a.action })),
          );
        }
      })
      .finally(() => setLoading(false));
  }, [serverId]);

  function addAction(action: "start" | "stop") {
    setActions((a) => [...a, { days: "1,2,3,4,5", time: action === "start" ? "08:00" : "18:00", action }]);
  }
  function update(i: number, patch: Partial<ActionRow>) {
    setActions((a) => a.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function remove(i: number) {
    setActions((a) => a.filter((_, idx) => idx !== i));
  }
  function toggleDay(i: number, day: string) {
    setActions((a) =>
      a.map((x, idx) => {
        if (idx !== i) return x;
        const set = new Set(x.days.split(",").filter(Boolean));
        if (set.has(day)) set.delete(day);
        else set.add(day);
        return { ...x, days: [...set].sort((p, q) => Number(p) - Number(q)).join(",") };
      }),
    );
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/servers/${serverId}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, timezone, actions }),
    });
    const d = await res.json();
    setSaving(false);
    if (!res.ok || !d.ok) {
      setMsg({ text: d.message ?? "Gagal menyimpan", ok: false });
      return;
    }
    setMsg({ text: "Jadwal tersimpan.", ok: true });
    onSaved?.();
  }

  if (loading) return <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />;

  return (
    <div className="animate-fade-up">
      {!managed && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
          Server ini belum ditandai <b>Dikelola</b> — jadwal bisa disimpan tapi tidak akan dieksekusi sampai server
          dikelola oleh app.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-emerald-600"
          />
          Aktifkan penjadwalan
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          Zona waktu
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-36 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300"
          />
        </label>
      </div>

      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        Tambahkan aksi: pilih hari, jam, dan apakah server <b>dinyalakan</b> atau <b>dimatikan</b> pada waktu itu.
        Status server mengikuti aksi terakhir yang sudah lewat.
      </p>

      <div className="mt-3 space-y-3">
        {actions.length === 0 && (
          <p className="rounded-xl border-2 border-dashed border-slate-200 p-5 text-center text-xs text-slate-400 dark:border-slate-700">
            Belum ada aksi — tambahkan di bawah.
          </p>
        )}
        {actions.map((a, i) => (
          <div
            key={i}
            className={`rounded-xl border p-4 transition ${
              a.action === "start"
                ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/30"
                : "border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={a.action}
                onChange={(e) => update(i, { action: e.target.value as "start" | "stop" })}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold outline-none ${
                  a.action === "start"
                    ? "border-emerald-300 bg-emerald-600 text-white dark:border-emerald-700"
                    : "border-slate-400 bg-slate-700 text-white dark:border-slate-500"
                }`}
              >
                <option value="start">▶ Nyalakan</option>
                <option value="stop">■ Matikan</option>
              </select>
              <span className="text-xs text-slate-400">pada jam</span>
              <TimeField value={a.time} onChange={(v) => update(i, { time: v })} />
              <button
                onClick={() => remove(i)}
                className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                Hapus
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {DAYS.map((d) => {
                const active = a.days.split(",").includes(d.v);
                return (
                  <button
                    key={d.v}
                    onClick={() => toggleDay(i, d.v)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                      active
                        ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900"
                        : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700 dark:hover:bg-slate-700"
                    }`}
                  >
                    {d.l}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex gap-2">
          <button
            onClick={() => addAction("start")}
            className="flex-1 rounded-xl border-2 border-dashed border-emerald-300 px-3 py-2.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
          >
            + Aksi nyalakan
          </button>
          <button
            onClick={() => addAction("stop")}
            className="flex-1 rounded-xl border-2 border-dashed border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            + Aksi matikan
          </button>
        </div>
      </div>

      {msg && (
        <p
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${
            msg.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
          }`}
        >
          {msg.text}
        </p>
      )}

      <div className="mt-5 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {saving ? "Menyimpan…" : "Simpan jadwal"}
        </button>
      </div>
    </div>
  );
}
