"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

const input =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const card = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btn =
  "rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

export default function TwoFactorSection() {
  const { t } = useLang();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState("");
  const [disablePw, setDisablePw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/2fa").then((r) => r.json()).then((d) => setEnabled(!!d.enabled)).catch(() => setEnabled(false));
  }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    return d;
  }

  async function startSetup() {
    const d = await post({ action: "setup" });
    if (d.ok) setSetup(d.data);
    else setMsg({ text: d.message ?? t("tfa.errSetup"), ok: false });
  }

  async function enable() {
    const d = await post({ action: "enable", code });
    if (d.ok) {
      setEnabled(true);
      setSetup(null);
      setCode("");
      setMsg({ text: t("tfa.enabled"), ok: true });
    } else setMsg({ text: d.message ?? t("tfa.errCode"), ok: false });
  }

  async function disable() {
    const d = await post({ action: "disable", password: disablePw || undefined, code: code || undefined });
    if (d.ok) {
      setEnabled(false);
      setDisablePw("");
      setCode("");
      setMsg({ text: t("tfa.disabled"), ok: true });
    } else setMsg({ text: d.message ?? t("tfa.errDisable"), ok: false });
  }

  return (
    <div className={`${card} mt-5`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("tfa.title")}</h2>
        {enabled !== null && (
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${enabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
            {enabled ? t("tfa.active") : t("tfa.inactive")}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("tfa.hintApp")}</p>

      {msg && <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"}`}>{msg.text}</p>}

      {enabled === false && !setup && (
        <button onClick={startSetup} disabled={busy} className={`${btn} mt-4`}>{t("tfa.enableBtn")}</button>
      )}

      {enabled === false && setup && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("tfa.setupManual")}</p>
            <code className="mt-1 block break-all font-mono text-sm text-slate-800 dark:text-slate-100">{setup.secret}</code>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t("tfa.setupOtpauth")}</p>
            <code className="mt-1 block break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">{setup.otpauth}</code>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{t("tfa.codeLabel")}</label>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="123456" className={`${input} max-w-[160px] tracking-widest`} />
          </div>
          <button onClick={enable} disabled={busy || code.length !== 6} className={btn}>{t("tfa.confirmBtn")}</button>
        </div>
      )}

      {enabled === true && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t("tfa.disableHint")}</p>
          <div className="flex flex-wrap gap-3">
            <input type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} placeholder={t("tfa.accountPassword")} className={`${input} max-w-[220px]`} autoComplete="current-password" />
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder={t("tfa.orCode")} className={`${input} max-w-[160px] tracking-widest`} />
          </div>
          <button onClick={disable} disabled={busy || (!disablePw && code.length !== 6)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50">{t("tfa.disableBtn")}</button>
        </div>
      )}
    </div>
  );
}
