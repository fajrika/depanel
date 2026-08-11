"use client";

import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Account = { id: string; name: string };
type Server = { id: string; uuid: string; hostname: string; account: { id: string; name: string } };
type Opt = Record<string, unknown>;

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const input =
  "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const btn =
  "rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

/** depa list responses come back as either an array or {data:[…]}; normalise. */
function pull<T = Opt>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object" && Array.isArray((v as { data?: unknown }).data)) return (v as { data: T[] }).data;
  return [];
}
const oid = (o: Opt) => (o.id ?? o.location_id ?? o.tier_id ?? o.template_id ?? o.storage_type ?? o.value) as number;
const oname = (o: Opt) => String(o.name ?? o.label ?? o.title ?? o.city ?? o.hostname ?? oid(o));

export default function InfraPage() {
  const { t } = useLang();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [acc, setAcc] = useState<string>("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // options
  const [opts, setOpts] = useState<{ locations: Opt[]; tiers: Opt[]; systems: Opt[]; sizes: Opt[] } | null>(null);

  // create-instance form
  const [ci, setCi] = useState({ hostname: "", location_id: 0, template_id: 0, tier_id: 0, username: "root", password: "" });

  // blocks
  const [blocks, setBlocks] = useState<Opt[]>([]);
  const [blkLoc, setBlkLoc] = useState(0);
  const [nb, setNb] = useState({ name: "", storage_type: 0, size: "50" });

  // ssh
  const [keys, setKeys] = useState<Opt[]>([]);
  const [nk, setNk] = useState({ title: "", key: "" });

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then((d) => { if (d.ok) { setAccounts(d.data ?? []); if (d.data?.[0]) setAcc(d.data[0].id); } }).catch(() => {});
    fetch("/api/servers").then((r) => r.json()).then((d) => setServers(d.data ?? [])).catch(() => {});
  }, []);

  const loadAcc = useCallback(async (id: string) => {
    if (!id) return;
    setOpts(null);
    setBlocks([]);
    setKeys([]);
    const [o, b, k] = await Promise.all([
      fetch(`/api/accounts/${id}/options`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/accounts/${id}/blocks`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/accounts/${id}/ssh`).then((r) => r.json()).catch(() => ({})),
    ]);
    if (o.ok) setOpts({ locations: pull(o.data.locations), tiers: pull(o.data.tiers), systems: pull(o.data.systems), sizes: pull(o.data.sizes) });
    if (b.ok) setBlocks(pull(b.data.blocks));
    if (k.ok) setKeys(pull(k.data));
  }, []);

  useEffect(() => { loadAcc(acc); }, [acc, loadAcc]);

  async function send(path: string, method: string, body?: unknown, okText?: string) {
    setBusy(path + method);
    setMsg(null);
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    setMsg(d.ok ? { text: okText ?? t("inf.ok"), ok: true } : { text: d.message ?? t("inf.fail"), ok: false });
    if (d.ok) loadAcc(acc);
    return d.ok as boolean;
  }

  const accServers = servers.filter((s) => s.account.id === acc);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{t("inf.title")}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("inf.subtitle")}</p>

      <div className="mt-4 flex items-center gap-2">
        <label className="text-xs text-slate-500 dark:text-slate-400">{t("inf.account")}</label>
        <select value={acc} onChange={(e) => setAcc(e.target.value)} className={input}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {msg && <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"}`}>{msg.text}</p>}

      {/* ===== F11: Buat instance ===== */}
      <div className={`${card} mt-5`}>
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("inf.createInstance")}</h2>
        {!opts ? (
          <p className="mt-2 text-xs text-slate-400">{t("inf.loadingOpts")}</p>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("inf.hostname")}</label>
                <input value={ci.hostname} onChange={(e) => setCi({ ...ci, hostname: e.target.value })} className={`${input} mt-1 w-full`} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("inf.location")}</label>
                <select value={ci.location_id} onChange={(e) => setCi({ ...ci, location_id: +e.target.value })} className={`${input} mt-1 w-full`}>
                  <option value={0}>— {t("inf.selectPlaceholder")} —</option>
                  {opts.locations.map((o, i) => <option key={i} value={oid(o)}>{oname(o)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("inf.os")}</label>
                <select value={ci.template_id} onChange={(e) => setCi({ ...ci, template_id: +e.target.value })} className={`${input} mt-1 w-full`}>
                  <option value={0}>— {t("inf.selectPlaceholder")} —</option>
                  {opts.systems.map((o, i) => <option key={i} value={oid(o)}>{oname(o)} {String(o.version ?? "")}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("inf.tier")}</label>
                <select value={ci.tier_id} onChange={(e) => setCi({ ...ci, tier_id: +e.target.value })} className={`${input} mt-1 w-full`}>
                  <option value={0}>— {t("inf.selectPlaceholder")} —</option>
                  {opts.tiers.map((o, i) => <option key={i} value={oid(o)}>{oname(o)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("inf.user")}</label>
                <input value={ci.username} onChange={(e) => setCi({ ...ci, username: e.target.value })} className={`${input} mt-1 w-full`} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("inf.rootPassword")}</label>
                <input type="text" value={ci.password} onChange={(e) => setCi({ ...ci, password: e.target.value })} className={`${input} mt-1 w-full`} />
              </div>
            </div>
            <button
              disabled={busy !== null || !ci.hostname || !ci.location_id || !ci.template_id || ci.password.length < 6}
              onClick={() => {
                const body: Record<string, unknown> = { hostname: ci.hostname, location_id: ci.location_id, template_id: ci.template_id, username: ci.username, password: ci.password };
                if (ci.tier_id) body.tier_id = ci.tier_id;
                if (confirm(`${t("inf.confirmCreate1")} "${ci.hostname}"${t("inf.confirmCreate2")}`)) send(`/api/accounts/${acc}/create-instance`, "POST", body, t("inf.created"));
              }}
              className={`${btn} mt-4`}
            >
              {t("inf.createBtn")}
            </button>
          </>
        )}
      </div>

      {/* ===== F12: Block storage ===== */}
      <div className={`${card} mt-5`}>
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("inf.blockTitle")}</h2>
        <div className="mt-2 space-y-2">
          {blocks.length === 0 ? (
            <p className="text-xs text-slate-400">{t("inf.noBlocks")}</p>
          ) : (
            blocks.map((b, i) => {
              const bid = String(b.id ?? b.uuid ?? i);
              return (
                <div key={bid} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{oname(b)}</span>
                  <span className="text-xs text-slate-400">{String(b.size ?? "?")}GB · {String(b.status ?? b.attached_to ?? "-")}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <select
                      defaultValue=""
                      onChange={(e) => { if (e.target.value) send(`/api/accounts/${acc}/blocks/${bid}`, "PATCH", { op: "attach", instance_id: e.target.value }, t("inf.attached")); }}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
                    >
                      <option value="">{t("inf.attachTo")}</option>
                      {accServers.map((s) => <option key={s.id} value={s.uuid}>{s.hostname}</option>)}
                    </select>
                    <button onClick={() => send(`/api/accounts/${acc}/blocks/${bid}`, "PATCH", { op: "detach" }, t("inf.detached"))} className="text-xs text-slate-500 hover:underline">{t("inf.detach")}</button>
                    <button onClick={() => { const s = prompt(t("inf.resizePrompt")); if (s && +s >= 10) send(`/api/accounts/${acc}/blocks/${bid}`, "PATCH", { op: "resize", size: +s }, t("inf.resized")); }} className="text-xs text-slate-500 hover:underline">Resize</button>
                    <button onClick={() => { if (confirm(t("inf.confirmDeleteBlock"))) send(`/api/accounts/${acc}/blocks/${bid}`, "DELETE", undefined, t("inf.blockDeleted")); }} className="text-xs text-red-500 hover:underline">{t("inf.delete")}</button>
                  </span>
                </div>
              );
            })
          )}
        </div>
        {/* buat block */}
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("inf.name")}</label><input value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} className={`${input} mt-1 w-36`} /></div>
          <div>
            <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("inf.location")}</label>
            <select value={blkLoc} onChange={(e) => setBlkLoc(+e.target.value)} className={`${input} mt-1`}>
              <option value={0}>— {t("inf.selectPlaceholder")} —</option>
              {opts?.locations.map((o, i) => <option key={i} value={oid(o)}>{oname(o)}</option>)}
            </select>
          </div>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("inf.typeNum")}</label><input value={nb.storage_type} onChange={(e) => setNb({ ...nb, storage_type: +e.target.value.replace(/\D/g, "") })} className={`${input} mt-1 w-20`} /></div>
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("inf.sizeGb")}</label><input value={nb.size} onChange={(e) => setNb({ ...nb, size: e.target.value.replace(/\D/g, "") })} className={`${input} mt-1 w-24`} /></div>
          <button
            disabled={busy !== null || !nb.name || !blkLoc || !nb.size}
            onClick={() => send(`/api/accounts/${acc}/blocks`, "POST", { name: nb.name, location_id: blkLoc, storage_type: nb.storage_type, size: nb.size }, t("inf.blockCreated"))}
            className={btn}
          >
            {t("inf.createBlock")}
          </button>
        </div>
      </div>

      {/* ===== F13: SSH keys ===== */}
      <div className={`${card} mt-5`}>
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("inf.sshKeysTitle")}</h2>
        <div className="mt-2 space-y-2">
          {keys.length === 0 ? (
            <p className="text-xs text-slate-400">{t("inf.noSshKeys")}</p>
          ) : (
            keys.map((k, i) => {
              const kid = String(k.id ?? k.uuid ?? i);
              return (
                <div key={kid} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{oname(k)}</span>
                  {typeof k.fingerprint === "string" && <span className="truncate font-mono text-[11px] text-slate-400">{k.fingerprint}</span>}
                  <button onClick={() => { if (confirm(t("inf.confirmDeleteKey"))) send(`/api/accounts/${acc}/ssh/${kid}`, "DELETE", undefined, t("inf.keyDeleted")); }} className="ml-auto text-xs text-red-500 hover:underline">{t("inf.delete")}</button>
                </div>
              );
            })
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div><label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("inf.titleLabel")}</label><input value={nk.title} onChange={(e) => setNk({ ...nk, title: e.target.value })} className={`${input} mt-1 w-36`} /></div>
          <div className="min-w-0 flex-1"><label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("inf.pubKey")}</label><input value={nk.key} onChange={(e) => setNk({ ...nk, key: e.target.value })} className={`${input} mt-1 w-full font-mono`} /></div>
          <button disabled={busy !== null || !nk.title || nk.key.length < 20} onClick={() => send(`/api/accounts/${acc}/ssh`, "POST", nk, t("inf.keyAdded"))} className={btn}>{t("inf.addKey")}</button>
        </div>
      </div>
    </div>
  );
}
