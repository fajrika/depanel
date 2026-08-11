"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const input =
  "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const btn = "rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

type Tier = { id?: number; tier_id?: number; name?: string; tier?: string };
type OS = { template_id?: number; id?: number; name?: string; version?: string };

export default function ManagePanel({ serverId, hostname, spec, onChanged }: { serverId: string; hostname: string; spec?: { cpu: number | null; memoryGb: number | null; storageGb: number | null; useDedicatedCpu?: boolean | null } | null; onChanged?: () => void }) {
  const { t } = useLang();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rz, setRz] = useState({ cpu: 2, memory: 4, storage: 20, use_dedicated_cpu: false });
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [tierId, setTierId] = useState<number | "">("");
  const [oses, setOses] = useState<OS[]>([]);
  const [ri, setRi] = useState({ template_id: 0, username: "root", password: "" });
  const [newName, setNewName] = useState(hostname);

  // Isi form resize dengan spek server saat ini (dari DB, bukan hardcode).
  useEffect(() => {
    if (spec?.cpu || spec?.memoryGb || spec?.storageGb) {
      setRz({
        cpu: spec.cpu ?? 2,
        memory: spec.memoryGb ?? 4,
        storage: spec.storageGb ?? 20,
        use_dedicated_cpu: spec.useDedicatedCpu === true,
      });
    }
  }, [spec]);

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
    setMsg(d.ok ? { text: t("mg.sent"), ok: true } : { text: d.message ?? t("mg.fail"), ok: false });
    if (d.ok) onChanged?.();
  }

  return (
    <div className="animate-fade-up space-y-5">
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"}`}>{msg.text}</p>}

      {/* Rename */}
      <div className={`${card} flex flex-wrap items-end gap-3`}>
        <div className="min-w-0 flex-1"><label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("mg.renameLabel")}</label><input value={newName} onChange={(e) => setNewName(e.target.value)} className={`${input} mt-1 w-full max-w-xs`} /></div>
        <button disabled={busy === "rename"} onClick={() => call("rename", `/api/servers/${serverId}`, "PATCH", { hostname: newName })} className={btn}>{t("mg.renameBtn")}</button>
      </div>

      {/* Resize */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("mg.resizeTitle")}</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("mg.vcpu")}</label><input type="number" value={rz.cpu} onChange={(e) => setRz({ ...rz, cpu: +e.target.value })} className={`${input} mt-1 w-20`} /></div>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("mg.ram")}</label><input type="number" value={rz.memory} onChange={(e) => setRz({ ...rz, memory: +e.target.value })} className={`${input} mt-1 w-20`} /></div>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("mg.disk")}</label><input type="number" value={rz.storage} onChange={(e) => setRz({ ...rz, storage: +e.target.value })} className={`${input} mt-1 w-20`} /></div>
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={rz.use_dedicated_cpu} onChange={(e) => setRz({ ...rz, use_dedicated_cpu: e.target.checked })} className="h-3.5 w-3.5 accent-slate-700" /> {t("mg.dedicatedCpu")}</label>
          <button disabled={busy === "resize"} onClick={() => call("resize", `/api/servers/${serverId}/resize`, "PATCH", rz, `${t("mg.resizeConfirm")} ${hostname} ke ${rz.cpu}CPU/${rz.memory}GB/${rz.storage}GB? ${t("mg.serverReboot")}`)} className={btn}>{t("mg.resizeBtn")}</button>
        </div>
      </div>

      {/* Change tier */}
      {tiers.length > 0 && (
        <div className={`${card} flex flex-wrap items-end gap-3`}>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("mg.tierLabel")}</label>
            <select value={tierId} onChange={(e) => setTierId(e.target.value ? +e.target.value : "")} className={`${input} mt-1`}>
              <option value="">{t("mg.selectTier")}</option>
              {tiers.map((t, i) => <option key={i} value={t.id ?? t.tier_id}>{t.name ?? t.tier ?? `Tier ${t.id ?? t.tier_id}`}</option>)}
            </select>
          </div>
          <button disabled={busy === "tier" || tierId === ""} onClick={() => call("tier", `/api/servers/${serverId}/tier`, "PATCH", { tier_id: tierId }, t("mg.confirmTier"))} className={btn}>{t("mg.tierBtn")}</button>
        </div>
      )}

      {/* Reinstall */}
      <div className={`${card} border-amber-200 dark:border-amber-900`}>
        <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">{t("mg.reinstallTitle")}</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("mg.os")}</label>
            <select value={ri.template_id} onChange={(e) => setRi({ ...ri, template_id: +e.target.value })} className={`${input} mt-1`}>
              <option value={0}>{t("mg.selectOs")}</option>
              {oses.map((o, i) => <option key={i} value={o.template_id ?? o.id}>{o.name} {o.version ?? ""}</option>)}
            </select>
          </div>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("mg.user")}</label><input value={ri.username} onChange={(e) => setRi({ ...ri, username: e.target.value })} className={`${input} mt-1 w-24`} /></div>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("mg.newPassword")}</label><input type="text" value={ri.password} onChange={(e) => setRi({ ...ri, password: e.target.value })} className={`${input} mt-1 w-40`} /></div>
          <button disabled={busy === "reinstall" || !ri.template_id || ri.password.length < 6} onClick={() => call("reinstall", `/api/servers/${serverId}/reinstall`, "PATCH", ri, `${t("mg.reinstallConfirm1")} ${hostname}${t("mg.reinstallConfirm2")}`)} className="rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-amber-500 disabled:opacity-50">{t("mg.reinstallBtn")}</button>
        </div>
      </div>

      {/* Delete */}
      <div className={`${card} border-red-200 dark:border-red-900`}>
        <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">{t("mg.deleteTitle")}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("mg.deleteSubtitle")}</p>
        <button
          disabled={busy === "delete"}
          onClick={() => {
            const c = prompt(`${t("mg.deletePrompt")} "${hostname}" ${t("mg.deletePrompt2")}`);
            if (c === hostname) call("delete", `/api/servers/${serverId}`, "DELETE", { remove_ip: false, remove_block_storage: false });
            else if (c !== null) setMsg({ text: t("mg.nameMismatch"), ok: false });
          }}
          className="mt-3 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
        >
          {t("mg.deleteBtn")}
        </button>
      </div>
    </div>
  );
}
