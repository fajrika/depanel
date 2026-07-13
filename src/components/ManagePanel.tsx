"use client";

import { useEffect, useState } from "react";

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const input =
  "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const btn = "rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

type Tier = { id?: number; tier_id?: number; name?: string; tier?: string };
type OS = { template_id?: number; id?: number; name?: string; version?: string };

export default function ManagePanel({ serverId, hostname, onChanged }: { serverId: string; hostname: string; onChanged?: () => void }) {
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rz, setRz] = useState({ cpu: 2, memory: 4, storage: 20, use_dedicated_cpu: false });
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [tierId, setTierId] = useState<number | "">("");
  const [oses, setOses] = useState<OS[]>([]);
  const [ri, setRi] = useState({ template_id: 0, username: "root", password: "" });
  const [newName, setNewName] = useState(hostname);

  useEffect(() => {
    setNewName(hostname);
    fetch(`/api/servers/${serverId}/tier`).then((r) => r.json()).then((d) => { if (d.ok) setTiers(Array.isArray(d.data.tiers) ? d.data.tiers : (d.data.tiers?.data ?? [])); }).catch(() => {});
    fetch(`/api/servers/${serverId}/reinstall`).then((r) => r.json()).then((d) => { if (d.ok) setOses(Array.isArray(d.data.systems) ? d.data.systems : (d.data.systems?.data ?? [])); }).catch(() => {});
  }, [serverId, hostname]);

  async function call(key: string, path: string, method: string, body?: unknown, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(key);
    setMsg(null);
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    setMsg(d.ok ? { text: "Berhasil dikirim ke depa.", ok: true } : { text: d.message ?? "Gagal", ok: false });
    if (d.ok) onChanged?.();
  }

  return (
    <div className="animate-fade-up space-y-5">
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"}`}>{msg.text}</p>}

      {/* Rename */}
      <div className={`${card} flex flex-wrap items-end gap-3`}>
        <div className="min-w-0 flex-1"><label className="block text-[11px] text-slate-500 dark:text-slate-400">Ganti hostname</label><input value={newName} onChange={(e) => setNewName(e.target.value)} className={`${input} mt-1 w-full max-w-xs`} /></div>
        <button disabled={busy === "rename"} onClick={() => call("rename", `/api/servers/${serverId}`, "PATCH", { hostname: newName })} className={btn}>Simpan nama</button>
      </div>

      {/* Resize */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Resize (custom spec)</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">vCPU</label><input type="number" value={rz.cpu} onChange={(e) => setRz({ ...rz, cpu: +e.target.value })} className={`${input} mt-1 w-20`} /></div>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">RAM (GB)</label><input type="number" value={rz.memory} onChange={(e) => setRz({ ...rz, memory: +e.target.value })} className={`${input} mt-1 w-20`} /></div>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">Disk (GB)</label><input type="number" value={rz.storage} onChange={(e) => setRz({ ...rz, storage: +e.target.value })} className={`${input} mt-1 w-20`} /></div>
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={rz.use_dedicated_cpu} onChange={(e) => setRz({ ...rz, use_dedicated_cpu: e.target.checked })} className="h-3.5 w-3.5 accent-slate-700" /> CPU dedicated</label>
          <button disabled={busy === "resize"} onClick={() => call("resize", `/api/servers/${serverId}/resize`, "PATCH", rz, `Resize ${hostname} ke ${rz.cpu}CPU/${rz.memory}GB/${rz.storage}GB? Server akan reboot.`)} className={btn}>Resize</button>
        </div>
      </div>

      {/* Change tier */}
      {tiers.length > 0 && (
        <div className={`${card} flex flex-wrap items-end gap-3`}>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">Ganti tier (paket)</label>
            <select value={tierId} onChange={(e) => setTierId(e.target.value ? +e.target.value : "")} className={`${input} mt-1`}>
              <option value="">— pilih tier —</option>
              {tiers.map((t, i) => <option key={i} value={t.id ?? t.tier_id}>{t.name ?? t.tier ?? `Tier ${t.id ?? t.tier_id}`}</option>)}
            </select>
          </div>
          <button disabled={busy === "tier" || tierId === ""} onClick={() => call("tier", `/api/servers/${serverId}/tier`, "PATCH", { tier_id: tierId }, "Ganti tier server ini?")} className={btn}>Ganti tier</button>
        </div>
      )}

      {/* Reinstall */}
      <div className={`${card} border-amber-200 dark:border-amber-900`}>
        <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">⚠️ Reinstall OS (menghapus seluruh data server)</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">OS</label>
            <select value={ri.template_id} onChange={(e) => setRi({ ...ri, template_id: +e.target.value })} className={`${input} mt-1`}>
              <option value={0}>— pilih OS —</option>
              {oses.map((o, i) => <option key={i} value={o.template_id ?? o.id}>{o.name} {o.version ?? ""}</option>)}
            </select>
          </div>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">User</label><input value={ri.username} onChange={(e) => setRi({ ...ri, username: e.target.value })} className={`${input} mt-1 w-24`} /></div>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">Password baru</label><input type="text" value={ri.password} onChange={(e) => setRi({ ...ri, password: e.target.value })} className={`${input} mt-1 w-40`} /></div>
          <button disabled={busy === "reinstall" || !ri.template_id || ri.password.length < 6} onClick={() => call("reinstall", `/api/servers/${serverId}/reinstall`, "PATCH", ri, `REINSTALL ${hostname}? SEMUA DATA HILANG dan tidak bisa dibatalkan.`)} className="rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-amber-500 disabled:opacity-50">Reinstall</button>
        </div>
      </div>

      {/* Delete */}
      <div className={`${card} border-red-200 dark:border-red-900`}>
        <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">🗑️ Hapus instance</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Menghapus server ini permanen di depa. Tidak berlaku untuk server bertanda production.</p>
        <button
          disabled={busy === "delete"}
          onClick={() => {
            const c = prompt(`Ketik "${hostname}" untuk konfirmasi penghapusan permanen:`);
            if (c === hostname) call("delete", `/api/servers/${serverId}`, "DELETE", { remove_ip: false, remove_block_storage: false });
            else if (c !== null) setMsg({ text: "Nama tidak cocok — dibatalkan.", ok: false });
          }}
          className="mt-3 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
        >
          Hapus instance ini
        </button>
      </div>
    </div>
  );
}
