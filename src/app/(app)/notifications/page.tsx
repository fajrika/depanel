"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Channel = {
  id: string;
  type: "telegram" | "discord" | "webhook";
  label: string;
  enabled: boolean;
  onPower: boolean;
  onBackup: boolean;
  onError: boolean;
  onBalance: boolean;
  chatId: string;
  url: string;
  hasToken: boolean;
};

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const input =
  "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const btn =
  "rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

const TYPE_HINT: Record<string, string> = {
  telegram: "notif.hint.telegram",
  discord: "notif.hint.discord",
  webhook: "notif.hint.webhook",
};

export default function NotificationsPage() {
  const { t } = useLang();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [threshold, setThreshold] = useState<string>("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // form tambah channel
  const [type, setType] = useState<Channel["type"]>("telegram");
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [url, setUrl] = useState("");

  // edit channel yang sudah ada
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ label: "", chatId: "", url: "", token: "" });

  function startEdit(c: Channel) {
    setEditId(c.id);
    setEdit({ label: c.label, chatId: c.chatId, url: c.url, token: "" });
    setMsg(null);
  }

  async function saveEdit(c: Channel) {
    setBusy("edit" + c.id);
    setMsg(null);
    const config: Record<string, string> = {};
    if (c.type === "telegram") {
      config.chatId = edit.chatId;
      if (edit.token) config.botToken = edit.token; // kosong = pertahankan token lama
    } else {
      config.url = edit.url;
    }
    const res = await fetch(`/api/notify/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: edit.label || c.label, config }),
    });
    const d = await res.json();
    setBusy(null);
    if (d.ok) {
      setEditId(null);
      setMsg({ text: t("notif.updated"), ok: true });
      load();
    } else {
      setMsg({ text: d.message ?? t("notif.errSave"), ok: false });
    }
  }

  async function load() {
    try {
      const res = await fetch("/api/notify");
      const d = await res.json();
      if (d.ok) {
        setChannels(d.data ?? []);
        setThreshold(d.lowBalanceThreshold != null ? String(d.lowBalanceThreshold) : "");
      }
    } catch {
      /* jaringan sesaat tak tersambung — jangan crash UI */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function saveThreshold() {
    setBusy("threshold");
    setMsg(null);
    const res = await fetch("/api/notify", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lowBalanceThreshold: threshold === "" ? null : Number(threshold) }),
    });
    const d = await res.json();
    setBusy(null);
    setMsg(d.ok ? { text: t("notif.thresholdSaved"), ok: true } : { text: d.message ?? t("notif.failed"), ok: false });
  }

  async function addChannel() {
    setBusy("add");
    setMsg(null);
    const config = type === "telegram" ? { botToken: token, chatId } : { url };
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, label: label || type, config }),
    });
    const d = await res.json();
    setBusy(null);
    if (d.ok) {
      setMsg({ text: t("notif.added"), ok: true });
      setLabel("");
      setToken("");
      setChatId("");
      setUrl("");
      load();
    } else {
      setMsg({ text: d.message ?? t("notif.errAdd"), ok: false });
    }
  }

  async function patchChannel(id: string, body: Record<string, unknown>) {
    await fetch(`/api/notify/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    load();
  }

  async function removeChannel(id: string) {
    if (!confirm(t("notif.confirmDelete"))) return;
    await fetch(`/api/notify/${id}`, { method: "DELETE" });
    load();
  }

  async function testChannel(id: string) {
    setBusy("test" + id);
    setMsg(null);
    const res = await fetch(`/api/notify/${id}/test`, { method: "POST" });
    const d = await res.json();
    setBusy(null);
    setMsg(d.ok ? { text: t("notif.testSent"), ok: true } : { text: d.message ?? t("notif.testFailed"), ok: false });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{t("notif.title")}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {t("notif.subtitle")}
      </p>

      {msg && (
        <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"}`}>{msg.text}</p>
      )}

      {/* Ambang saldo */}
      <div className={`${card} mt-5 flex flex-wrap items-end gap-3`}>
        <div>
          <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("notif.thresholdLabel")}</label>
          <input value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/[^\d]/g, ""))} placeholder={t("notif.thresholdPlaceholder")} className={`${input} mt-1 w-48`} />
        </div>
        <button onClick={saveThreshold} disabled={busy === "threshold"} className={btn}>{t("notif.saveThreshold")}</button>
      </div>

      {/* Daftar channel */}
      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
        ) : channels.length === 0 ? (
          <p className="text-sm text-slate-400">{t("notif.empty")}</p>
        ) : (
          channels.map((c) => (
            <div key={c.id} className={card}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{c.type}</span>
                  <span className="font-medium text-slate-800 dark:text-slate-100">{c.label}</span>
                  {!c.enabled && <span className="text-[11px] text-slate-400">({t("notif.disabled")})</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => testChannel(c.id)} disabled={busy === "test" + c.id} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">{t("notif.test")}</button>
                  <button onClick={() => (editId === c.id ? setEditId(null) : startEdit(c))} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">{editId === c.id ? t("notif.close") : t("notif.edit")}</button>
                  <button onClick={() => patchChannel(c.id, { enabled: !c.enabled })} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">{c.enabled ? t("notif.disable") : t("notif.enable")}</button>
                  <button onClick={() => removeChannel(c.id)} className="rounded-lg border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/40">{t("notif.delete")}</button>
                </div>
              </div>

              {/* form edit */}
              {editId === c.id && (
                <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("notif.label")}</label>
                      <input value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} className={`${input} mt-1 w-40`} />
                    </div>
                    {c.type === "telegram" ? (
                      <>
                        <div>
                          <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("notif.chatId")}</label>
                          <input value={edit.chatId} onChange={(e) => setEdit({ ...edit, chatId: e.target.value })} className={`${input} mt-1 w-40`} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("notif.botToken")} {c.hasToken && <span className="text-slate-400">({t("notif.tokenKeepOld")})</span>}</label>
                          <input value={edit.token} onChange={(e) => setEdit({ ...edit, token: e.target.value })} placeholder={c.hasToken ? t("notif.tokenSaved") : ""} className={`${input} mt-1 w-56`} />
                        </div>
                      </>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("notif.webhookUrl")}</label>
                        <input value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} className={`${input} mt-1 w-full`} />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(c)} disabled={busy === "edit" + c.id} className={btn}>{busy === "edit" + c.id ? t("notif.saving") : t("notif.saveChanges")}</button>
                    <button onClick={() => setEditId(null)} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">{t("notif.cancel")}</button>
                  </div>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-3">
                {([["onPower", t("notif.evPower")], ["onBackup", t("notif.evBackup")], ["onError", t("notif.evError")], ["onBalance", t("notif.evBalance")]] as const).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={c[k]} onChange={() => patchChannel(c.id, { [k]: !c[k] })} className="h-3.5 w-3.5 accent-indigo-600" />
                    {l}
                  </label>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Tambah channel */}
      <div className={`${card} mt-5`}>
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("notif.addChannel")}</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("notif.type")}</label>
            <select value={type} onChange={(e) => setType(e.target.value as Channel["type"])} className={`${input} mt-1`}>
              <option value="telegram">Telegram</option>
              <option value="discord">Discord</option>
              <option value="webhook">Webhook</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("notif.label")}</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("notif.labelPlaceholder")} className={`${input} mt-1 w-40`} />
          </div>
          {type === "telegram" ? (
            <>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("notif.botToken")}</label>
                <input value={token} onChange={(e) => setToken(e.target.value)} className={`${input} mt-1 w-56`} />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("notif.chatId")}</label>
                <input value={chatId} onChange={(e) => setChatId(e.target.value)} className={`${input} mt-1 w-32`} />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400">{t("notif.webhookUrl")}</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)} className={`${input} mt-1 w-72`} />
            </div>
          )}
        </div>
        <p className="mt-3 text-[11px] text-slate-400">{t(TYPE_HINT[type])} · {t("notif.defaultHint")}</p>
        <button onClick={addChannel} disabled={busy === "add"} className={`${btn} mt-3`}>{t("notif.addChannel")}</button>
      </div>
    </div>
  );
}
