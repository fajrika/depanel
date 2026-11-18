"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { dict as serverPages } from "./i18n-pages-server";
import { dict as sshPages } from "./i18n-pages-ssh";
import { dict as backupPages } from "./i18n-pages-backup";
import { dict as miscPages } from "./i18n-pages-misc";
import { dict as healthPages } from "./i18n-pages-health";
import { dict as secPages } from "./i18n-pages-sec";
import { dict as sshcmdPages } from "./i18n-pages-sshcmd";
import { dict as reportPages } from "./i18n-pages-report";
import { dict as approvalsPages } from "./i18n-pages-approvals";
import { dict as sshhealthPages } from "./i18n-pages-sshhealth";
import { dict as panelbackupPages } from "./i18n-pages-panelbackup";
import { dict as wifiPages } from "./i18n-pages-wifi";
import { dict as laporanPages } from "./i18n-pages-laporan";
import { dict as speedtestPages } from "./i18n-pages-speedtest";

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
    "nav.sshhealth": "Health App",
    "nav.approvals": "Persetujuan",
    "nav.sshcmd": "SSH Script",
    "nav.wifi": "WiFi",
    "nav.billing": "Saldo",
    "nav.cost": "Biaya",
    "nav.reports": "Laporan",
    "nav.notifications": "Notifikasi",
    "nav.health": "Health Check",
    "nav.logs": "Log",
    "nav.panelbackup": "Backup Panel",
    "nav.teams": "Tim",
    "nav.superadmin": "Super Admin",
    "group.kelola": "Kelola",
    "group.keuangan": "Keuangan",
    "group.sistem": "Sistem",
    "group.lainnya": "Lainnya",
    "nav.menuSettings": "⚙ Atur menu utama",
    "prof.menuTitle": "Menu utama",
    "prof.menuSubtitle": "Pilih menu yang tampil langsung di bar kiri/atas. Menu yang tidak dicentang dikumpulkan di grup \"Lainnya\", jadi tetap bisa dibuka.",
    "prof.menuPinned": "selalu tampil",
    "prof.menuShowAll": "Tampilkan semua",
    "prof.menuHideAll": "Sembunyikan semua",
    "prof.menuReset": "Kembalikan default",
    "prof.menuSave": "Simpan menu",
    "prof.menuSaved": "Menu utama disimpan.",
    "prof.menuMoved": "menu di \"Lainnya\"",
    "prof.menuTeamNote": "Daftar ini mengikuti izin tim aktif; pengaturan berlaku untuk semua tim Anda.",
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
    "notif.bell": "Notifikasi",
    "notif.empty": "Tidak ada notifikasi.",
    "notif.markAll": "Tandai semua dibaca",
    "err.title": "Terjadi kesalahan",
    "err.retry": "Coba lagi",
    "pwa.update": "Versi baru tersedia!",
    "pwa.hint": "Klik untuk memuat ulang ke versi terbaru.",
    "pwa.reload": "Muat Ulang",
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
    "nav.sshhealth": "App Health",
    "nav.approvals": "Approvals",
    "nav.sshcmd": "SSH Script",
    "nav.wifi": "WiFi",
    "nav.billing": "Balance",
    "nav.cost": "Cost",
    "nav.reports": "Reports",
    "nav.notifications": "Notifications",
    "nav.health": "Health Check",
    "nav.logs": "Logs",
    "nav.panelbackup": "Panel Backup",
    "nav.teams": "Teams",
    "nav.superadmin": "Super Admin",
    "group.kelola": "Manage",
    "group.keuangan": "Finance",
    "group.sistem": "System",
    "group.lainnya": "More",
    "nav.menuSettings": "⚙ Customize main menu",
    "prof.menuTitle": "Main menu",
    "prof.menuSubtitle": "Choose which menus appear directly in the left/top bar. Unchecked menus are collected under \"More\", so they stay reachable.",
    "prof.menuPinned": "always shown",
    "prof.menuShowAll": "Show all",
    "prof.menuHideAll": "Hide all",
    "prof.menuReset": "Restore default",
    "prof.menuSave": "Save menu",
    "prof.menuSaved": "Main menu saved.",
    "prof.menuMoved": "menus in \"More\"",
    "prof.menuTeamNote": "This list follows the active team's permissions; the setting applies to all your teams.",
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
    "notif.bell": "Notifications",
    "notif.empty": "No notifications.",
    "notif.markAll": "Mark all as read",
    "err.title": "Something went wrong",
    "err.retry": "Try again",
    "pwa.update": "A new version is available!",
    "pwa.hint": "Click to reload to the latest version.",
    "pwa.reload": "Reload",
    "role.owner": "owner",
    "role.admin": "admin",
    "role.member": "member",
  },
};

// gabungkan kamus per-modul halaman
for (const mod of [serverPages, sshPages, backupPages, miscPages, healthPages, secPages, sshcmdPages, reportPages, approvalsPages, sshhealthPages, panelbackupPages, wifiPages, laporanPages, speedtestPages]) {
  dict.id = { ...dict.id, ...mod.id };
  dict.en = { ...dict.en, ...mod.en };
}

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
