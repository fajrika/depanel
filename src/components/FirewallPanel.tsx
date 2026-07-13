"use client";

import { useCallback, useEffect, useState } from "react";

type Rule = Record<string, unknown> & { id?: string | number };

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const input =
  "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

function rows(v: unknown): Rule[] {
  if (Array.isArray(v)) return v as Rule[];
  if (v && typeof v === "object") {
    const d = v as Record<string, unknown>;
    if (Array.isArray(d.data)) return d.data as Rule[];
    if (d.data && typeof d.data === "object" && Array.isArray((d.data as Record<string, unknown>).data)) {
      return (d.data as Record<string, unknown>).data as Rule[];
    }
  }
  return [];
}

export default function FirewallPanel({ serverId, isStaff }: { serverId: string; isStaff: boolean }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ destination_port: "", protocol: "tcp", action: "A", source_ip: "", description: "" });

  const load = useCallback(async () => {
    const res = await fetch(`/api/servers/${serverId}/firewall`);
    const d = await res.json();
    if (d.ok) setRules(rows(d.data.rules));
    else setMsg({ text: d.message, ok: false });
  }, [serverId]);

  useEffect(() => {
    setRules(null);
    load();
  }, [load]);

  async function api(path: string, method: string, body?: unknown) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(d.ok ? { text: "Berhasil.", ok: true } : { text: d.message ?? "Gagal", ok: false });
    load();
  }

  return (
    <div className="animate-fade-up space-y-5">
      {msg && (
        <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"}`}>{msg.text}</p>
      )}

      {isStaff && (
        <form
          className={`${card} flex flex-wrap items-end gap-3`}
          onSubmit={(e) => {
            e.preventDefault();
            api(`/api/servers/${serverId}/firewall`, "POST", { ...form, use_ipset: false }).then(() =>
              setForm({ destination_port: "", protocol: "tcp", action: "A", source_ip: "", description: "" }),
            );
          }}
        >
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">Port</label><input required value={form.destination_port} onChange={(e) => setForm({ ...form, destination_port: e.target.value })} placeholder="22" className={`${input} mt-1 w-20`} /></div>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">Protokol</label><select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })} className={`${input} mt-1`}><option value="tcp">tcp</option><option value="udp">udp</option></select></div>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">Aksi</label><select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} className={`${input} mt-1`}><option value="A">Terima (ACCEPT)</option><option value="D">Tolak (DROP)</option></select></div>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">Source IP (opsional)</label><input value={form.source_ip} onChange={(e) => setForm({ ...form, source_ip: e.target.value })} placeholder="0.0.0.0/0" className={`${input} mt-1 w-36`} /></div>
          <div className="min-w-0 flex-1"><label className="block text-[11px] text-slate-500 dark:text-slate-400">Deskripsi</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`${input} mt-1 w-full`} /></div>
          <button disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300">+ Rule</button>
        </form>
      )}

      <div className={card}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Aturan firewall</h3>
        <div className="mt-3 space-y-2">
          {rules === null ? (
            <div className="h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ) : rules.length === 0 ? (
            <p className="text-xs text-slate-400">Belum ada aturan firewall.</p>
          ) : (
            rules.map((r, i) => {
              const rid = String(r.id ?? i);
              const act = String(r.action ?? r.rule_action ?? "");
              return (
                <div key={rid} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-2.5 text-sm dark:border-slate-800 dark:bg-slate-800/40">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${act === "A" || /accept/i.test(act) ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400"}`}>
                    {act === "A" ? "ACCEPT" : act === "D" ? "DROP" : act || "?"}
                  </span>
                  <span className="font-medium text-slate-800 dark:text-slate-100">{String(r.protocol ?? "")}/{String(r.destination_port ?? r.port ?? "")}</span>
                  <span className="text-xs text-slate-400">{String(r.source_ip ?? r.source ?? "any")}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{String(r.description ?? "")}</span>
                  {isStaff && r.id != null && (
                    <button onClick={() => confirm("Hapus rule ini?") && api(`/api/servers/${serverId}/firewall/${rid}`, "DELETE")} disabled={busy} className="text-xs font-medium text-red-500 hover:underline">Hapus</button>
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
