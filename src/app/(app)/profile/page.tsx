"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import TwoFactorSection from "@/components/TwoFactorSection";
import { buildNavGroups, PINNED_NAV, type NavGroup, type NavPerms } from "@/lib/nav";

const input =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-300";
const label = "block text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const btn =
  "rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";

export default function ProfilePage() {
  const { t } = useLang();
  const [me, setMe] = useState<{ name: string; email: string; role: string; uiLayout?: string } | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [uiLayout, setUiLayout] = useState("topbar");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [navPerms, setNavPerms] = useState<{ team: NavPerms | null; superAdmin: boolean } | null>(null);
  const [navHidden, setNavHidden] = useState<Set<string>>(new Set());
  const [navSaved, setNavSaved] = useState<string[]>([]);

  // lompat ke kartu menu bila dibuka dari tautan "Atur menu utama"
  useEffect(() => {
    if (navPerms && window.location.hash === "#menu") {
      document.getElementById("menu")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [navPerms]);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.user) {
          setMe(d.user);
          setName(d.user.name);
          setEmail(d.user.email);
          setUiLayout(d.user.uiLayout ?? "topbar");
          const hidden: string[] = Array.isArray(d.user.navHidden) ? d.user.navHidden : [];
          setNavHidden(new Set(hidden));
          setNavSaved(hidden);
        }
        setNavPerms({ team: d?.activeTeam ?? null, superAdmin: d?.superAdmin ?? false });
      })
      .catch(() => {});
  }, []);

  async function patch(body: Record<string, unknown>, which: string) {
    setBusy(which);
    setMsg(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok || !d.ok) {
      setMsg({ text: d.message ?? t("prof.errSave"), ok: false });
      return false;
    }
    if (d.data) {
      setMe((m) => (m ? { ...m, ...d.data } : m));
      // Nav membaca /api/me saat load — refresh ringan agar nama baru tampil
      window.dispatchEvent(new Event("profile-updated"));
    }
    return true;
  }

  const navGroups: NavGroup[] = navPerms ? buildNavGroups(t, navPerms.team, navPerms.superAdmin) : [];
  const navAll = navGroups.flatMap((g) => g.items).filter((i) => !PINNED_NAV.has(i.href));
  const navDirty = [...navHidden].sort().join("|") !== [...navSaved].sort().join("|");
  const navHiddenCount = navAll.filter((i) => navHidden.has(i.href)).length;

  function toggleNav(href: string) {
    setNavHidden((s) => {
      const n = new Set(s);
      if (n.has(href)) n.delete(href);
      else n.add(href);
      return n;
    });
  }

  function setAllNav(hide: boolean) {
    setNavHidden((s) => {
      const n = new Set(s);
      for (const i of navAll) {
        if (hide) n.add(i.href);
        else n.delete(i.href);
      }
      return n;
    });
  }

  async function saveNav() {
    const list = [...navHidden];
    if (await patch({ navHidden: list }, "menu")) {
      setNavSaved(list);
      setMsg({ text: t("prof.menuSaved"), ok: true });
    }
  }

  async function saveInfo(e: React.FormEvent) {
    e.preventDefault();
    if (await patch({ name, email }, "info")) {
      setMsg({ text: t("prof.saved"), ok: true });
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setMsg({ text: t("prof.pwMismatch"), ok: false });
      return;
    }
    if (await patch({ currentPassword, newPassword }, "password")) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setMsg({ text: t("prof.pwChanged"), ok: true });
    }
  }

  async function logoutAll() {
    if (!window.confirm(t("sec.logoutAllConfirm"))) return;
    setBusy("logout-all");
    setMsg(null);
    try {
      const res = await fetch("/api/profile/logout-all", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        setMsg({ text: d.message ?? t("prof.errSave"), ok: false });
        return;
      }
      window.location.href = "/login";
    } catch {
      setMsg({ text: t("prof.errSave"), ok: false });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{t("prof.title")}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {t("prof.subtitle1")}
        {me?.role === "admin" && t("prof.adminNote")}
      </p>

      {msg && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
            msg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
          }`}
        >
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Info akun */}
      <form onSubmit={saveInfo} className={`${card} mt-5`}>
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("prof.infoTitle")}</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className={label}>{t("prof.name")}</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>{t("prof.email")}</label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{t("prof.emailHint")}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button disabled={busy === "info"} className={btn}>
            {busy === "info" ? t("prof.saving") : t("prof.saveBtn")}
          </button>
        </div>
      </form>

      {/* Tampilan menu */}
      <div className={`${card} mt-5`}>
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("prof.layoutTitle")}</h2>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{t("prof.layoutSubtitle")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { v: "topbar", l: t("prof.topbar"), d: t("prof.topbarDesc"), icon: "▬" },
            { v: "sidebar", l: t("prof.sidebar"), d: t("prof.sidebarDesc"), icon: "▮" },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={async () => {
                setUiLayout(o.v);
                if (await patch({ uiLayout: o.v }, "layout")) {
                  setMsg({ text: `${t("prof.layoutChanged1")} ${o.l}${t("prof.layoutChanged2")}`, ok: true });
                }
              }}
              disabled={busy === "layout"}
              className={`rounded-xl border-2 p-4 text-left transition ${
                uiLayout === o.v
                  ? "border-indigo-400 bg-indigo-50/50 dark:border-indigo-600 dark:bg-indigo-950/30"
                  : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
              }`}
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                <span className="text-lg">{o.icon}</span> {o.l}
                {uiLayout === o.v && <span className="ml-auto text-emerald-500">✓</span>}
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{o.d}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Menu utama: pilih menu yang tampil, sisanya ke grup "Lainnya" */}
      <div id="menu" className={`${card} mt-5 scroll-mt-20`}>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("prof.menuTitle")}</h2>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{t("prof.menuSubtitle")}</p>
          </div>
          {navHiddenCount > 0 && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {navHiddenCount} {t("prof.menuMoved")}
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <button type="button" onClick={() => setAllNav(false)} className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            {t("prof.menuShowAll")}
          </button>
          <button type="button" onClick={() => setAllNav(true)} className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            {t("prof.menuHideAll")}
          </button>
        </div>
        <div className="mt-4 space-y-4">
          {navGroups.map((g) => (
            <div key={g.key}>
              {g.label && <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{g.label}</p>}
              <div className="grid gap-1.5 sm:grid-cols-2">
                {g.items.map((i) => {
                  const pinned = PINNED_NAV.has(i.href);
                  const shown = pinned || !navHidden.has(i.href);
                  return (
                    <label
                      key={i.href}
                      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition ${
                        shown
                          ? "border-slate-200 text-slate-800 dark:border-slate-700 dark:text-slate-100"
                          : "border-dashed border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                      } ${pinned ? "cursor-default" : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
                    >
                      <input type="checkbox" checked={shown} disabled={pinned} onChange={() => toggleNav(i.href)} className="h-4 w-4 accent-indigo-600" />
                      <span>{i.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{i.label}</span>
                      {pinned && <span className="text-[10px] text-slate-400">{t("prof.menuPinned")}</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-slate-400 dark:text-slate-500">{t("prof.menuTeamNote")}</p>
        <div className="mt-4 flex items-center justify-end gap-2">
          {navSaved.length > 0 && (
            <button
              type="button"
              disabled={busy === "menu"}
              onClick={async () => {
                setNavHidden(new Set());
                if (await patch({ navHidden: [] }, "menu")) {
                  setNavSaved([]);
                  setMsg({ text: t("prof.menuSaved"), ok: true });
                }
              }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t("prof.menuReset")}
            </button>
          )}
          <button type="button" disabled={busy === "menu" || !navDirty} onClick={saveNav} className={btn}>
            {busy === "menu" ? t("prof.saving") : t("prof.menuSave")}
          </button>
        </div>
      </div>

      {/* Ganti password */}
      <form onSubmit={savePassword} className={`${card} mt-5`}>
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("prof.pwTitle")}</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className={label}>{t("prof.pwCurrent")}</label>
            <input
              required
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={input}
              autoComplete="current-password"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>{t("prof.pwNew")}</label>
              <input
                required
                type="password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={input}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className={label}>{t("prof.pwConfirm")}</label>
              <input
                required
                type="password"
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={input}
                autoComplete="new-password"
              />
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button disabled={busy === "password"} className={btn}>
            {busy === "password" ? t("prof.saving") : t("prof.pwBtn")}
          </button>
        </div>
      </form>

      {/* Keamanan */}
      <div className={`${card} mt-5`}>
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("sec.securityCard")}</h2>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{t("sec.securitySubtitle")}</p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={busy === "logout-all"}
            onClick={logoutAll}
            className="rounded-lg border border-red-200 px-5 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/50"
          >
            {busy === "logout-all" ? t("sec.processing") : t("sec.logoutAll")}
          </button>
        </div>
      </div>

      {/* 2FA (F6) */}
      <TwoFactorSection />
    </div>
  );
}
