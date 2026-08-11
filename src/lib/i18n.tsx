"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "id" | "en";

/** Kamus terjemahan shell aplikasi. Halaman lain ditambahkan bertahap. */
const dict: Record<Lang, Record<string, string>> = {
  id: {
    "nav.server": "Server",
    "nav.infra": "Infra",
    "nav.accounts": "Akun API",
    "nav.dbbackup": "Backup DB",
    "nav.dirclone": "Backup File",
    "nav.ssh": "SSH Koneksi",
    "nav.billing": "Saldo",
    "nav.cost": "Biaya",
    "nav.reports": "Laporan",
    "nav.notifications": "Notifikasi",
    "nav.logs": "Log",
    "nav.teams": "Tim",
    "nav.superadmin": "Super Admin",
    "group.kelola": "Kelola",
    "group.keuangan": "Keuangan",
    "group.sistem": "Sistem",
    "team.pilih": "Pilih tim",
    "team.kelola": "+ Kelola / buat tim",
    "team.personal": "Tim pribadi",
    "logout.title": "Keluar",
    "profile.title": "Profil saya",
    "theme.light": "Mode terang",
    "theme.dark": "Mode gelap",
    "lang.title": "Bahasa",
    "lang.id": "Indonesia",
    "lang.en": "English",
    "imp.banner": "Anda sedang menyamar sebagai",
    "imp.back": "← Kembali ke",
    "sidebar.collapse": "Ciutkan menu",
    "sidebar.expand": "Buka menu",
    "role.owner": "owner",
    "role.admin": "admin",
    "role.member": "member",
  },
  en: {
    "nav.server": "Servers",
    "nav.infra": "Infra",
    "nav.accounts": "API Accounts",
    "nav.dbbackup": "DB Backup",
    "nav.dirclone": "File Backup",
    "nav.ssh": "SSH Connections",
    "nav.billing": "Balance",
    "nav.cost": "Cost",
    "nav.reports": "Reports",
    "nav.notifications": "Notifications",
    "nav.logs": "Logs",
    "nav.teams": "Teams",
    "nav.superadmin": "Super Admin",
    "group.kelola": "Manage",
    "group.keuangan": "Finance",
    "group.sistem": "System",
    "team.pilih": "Select team",
    "team.kelola": "+ Manage / create team",
    "team.personal": "Personal team",
    "logout.title": "Logout",
    "profile.title": "My profile",
    "theme.light": "Light mode",
    "theme.dark": "Dark mode",
    "lang.title": "Language",
    "lang.id": "Indonesian",
    "lang.en": "English",
    "imp.banner": "You are impersonating",
    "imp.back": "← Back to",
    "sidebar.collapse": "Collapse menu",
    "sidebar.expand": "Expand menu",
    "role.owner": "owner",
    "role.admin": "admin",
    "role.member": "member",
  },
};

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
};

const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("id");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("depanel_lang");
      if (saved === "id" || saved === "en") setLangState(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("depanel_lang", l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: string) => {
      const table = dict[lang];
      return table[key] ?? dict.id[key] ?? key;
    },
    [lang],
  );

  return <LangCtx.Provider value={{ lang, setLang, t }}>{children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
  const ctx = useContext(LangCtx);
  if (!ctx) throw new Error("useLang harus dipakai di dalam LangProvider");
  return ctx;
}
