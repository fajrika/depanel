"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Me = { id: string; name: string; email: string; role: string; uiLayout: string };
type TeamInfo = {
  id: string;
  name: string;
  isPersonal: boolean;
  role: string;
  canViewBilling: boolean;
  canViewCost: boolean;
  canViewReports: boolean;
  canSchedule: boolean;
  canBackup: boolean;
  canBackupDb: boolean;
  canSsh: boolean;
  canInfra: boolean;
  canAccounts: boolean;
  canNotify: boolean;
};

/* ---------- switcher tim (dipakai topbar & sidebar) ---------- */
function TeamSwitcher({
  activeTeam,
  teams,
  compact,
  dropUp,
  mini,
  onSwitch,
}: {
  activeTeam: TeamInfo;
  teams: TeamInfo[];
  compact?: boolean; // versi ringkas untuk topbar
  dropUp?: boolean; // dropdown membuka ke atas (sidebar kiri-bawah)
  mini?: boolean; // sidebar collapsed: hanya ikon
  onSwitch: (id: string) => void;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative min-w-0">
      <button
        onClick={() => setOpen(!open)}
        title={mini ? activeTeam.name : `Tim aktif: ${activeTeam.name}`}
        className={`flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 ${
          mini
            ? "h-8 w-8 justify-center"
            : compact
              ? "h-8 max-w-[140px] px-2 py-1 text-xs sm:max-w-[180px]"
              : "w-full px-2.5 py-2"
        }`}
      >
        <span className={mini ? "" : "shrink-0"}>{activeTeam.isPersonal ? "👤" : "👥"}</span>
        {!mini && <span className="min-w-0 flex-1 truncate text-left">{activeTeam.name}</span>}
        {!mini && <span className={`shrink-0 text-[9px] text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>▼</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`animate-fade-up absolute z-50 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900 ${
              dropUp ? "bottom-full left-0 mb-1.5" : "right-0 top-full mt-1.5"
            }`}
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t_("team.pilih")}</p>
            {teams.map((tm) => (
              <button
                key={tm.id}
                onClick={() => {
                  setOpen(false);
                  onSwitch(tm.id);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                  tm.id === activeTeam.id
                    ? "bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                    : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60"
                }`}
              >
                <span>{tm.isPersonal ? "👤" : "👥"}</span>
                <span className="min-w-0 flex-1 truncate">{tm.name}</span>
                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {t_(`role.${tm.role}`)}
                </span>
                {tm.id === activeTeam.id && <span className="shrink-0 text-emerald-500">✓</span>}
              </button>
            ))}
            <div className="mt-1 border-t border-slate-100 pt-1 dark:border-slate-800">
              <Link
                href="/teams"
                onClick={() => setOpen(false)}
                className="block rounded-lg px-2.5 py-2 text-sm text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
              >
                {t_("team.kelola")}
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type NavItem = { href: string; label: string; icon: string };

/* ---------- bell notifikasi in-app ---------- */
type NotifItem = { id: string; type: string; title: string; message: string | null; read: boolean; createdAt: string };

function BellNotif({ dropUp }: { dropUp?: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inapp");
      const d = await res.json();
      if (d.ok) {
        setItems(d.data ?? []);
        setUnread(d.unreadCount ?? 0);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  async function markAll() {
    await fetch("/api/inapp", { method: "POST" });
    load();
  }
  async function markOne(id: string) {
    await fetch(`/api/inapp/${id}`, { method: "PATCH" });
    load();
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen(!open);
          if (!open) load();
        }}
        title={t("notif.bell")}
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-base transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`animate-fade-up absolute right-0 z-50 mt-1.5 w-80 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900 ${
              dropUp ? "bottom-full mb-1.5" : "top-full"
            }`}
          >
            <div className="flex items-center justify-between px-2.5 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t("notif.bell")}</p>
              {unread > 0 && (
                <button onClick={markAll} className="text-[11px] text-indigo-600 hover:underline dark:text-indigo-400">
                  {t("notif.markAll")}
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <p className="px-2.5 py-4 text-center text-xs text-slate-400">{t("notif.empty")}</p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => markOne(n.id)}
                    className={`block w-full rounded-lg px-2.5 py-2 text-left transition ${n.read ? "opacity-60" : "bg-slate-50 dark:bg-slate-800/60"}`}
                  >
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-100">{n.title}</p>
                    {n.message && <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">{n.message}</p>}
                    <p className="mt-0.5 text-[10px] text-slate-400">{new Date(n.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- dropdown grup menu (dipakai topbar) ---------- */
function NavDropdown({ label, icon, items, pathname }: { label: string; icon: string; items: NavItem[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const active = items.some((i) => i.href === pathname);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
          active || open
            ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
            : "text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200"
        }`}
      >
        <span className="text-[13px]">{icon}</span>
        {label}
        <span className={`text-[9px] text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="animate-fade-up absolute left-0 top-full z-50 mt-1.5 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
                  i.href === pathname
                    ? "bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                    : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60"
                }`}
              >
                <span className="text-base">{i.icon}</span> {i.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- shell utama ---------- */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, lang, setLang } = useLang();
  const [me, setMe] = useState<Me | null>(null);
  const [activeTeam, setActiveTeam] = useState<TeamInfo | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [impBy, setImpBy] = useState<{ id: string; name: string } | null>(null);
  const [dark, setDark] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    try {
      setCollapsed(localStorage.getItem("depanel_sidebar_collapsed") === "1");
    } catch {
      /* ignore */
    }
    const loadMe = () =>
      fetch("/api/me")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.user) setMe(d.user);
          if (d?.activeTeam) setActiveTeam(d.activeTeam);
          if (d?.teams) setTeams(d.teams);
          setSuperAdmin(d?.superAdmin ?? false);
          setImpBy(d?.impersonatedBy ?? null);
        })
        .catch(() => {});
    loadMe();
    window.addEventListener("profile-updated", loadMe);
    return () => window.removeEventListener("profile-updated", loadMe);
  }, []);

  useEffect(() => setMenuOpen(false), [pathname]);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  async function switchTeam(teamId: string) {
    if (teamId === activeTeam?.id) return;
    await fetch("/api/teams/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    });
    window.location.href = "/";
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function stopImpersonate() {
    await fetch("/api/superadmin/impersonate", { method: "DELETE" });
    window.location.href = "/superadmin";
  }

  const at = activeTeam;

  const t_ = t;
  const navGroups: { label: string | null; icon: string; items: (NavItem & { show: boolean })[] }[] = [
    { label: null, icon: "", items: [{ href: "/", label: t_("nav.server"), icon: "🖥️", show: true }] },
    {
      label: t_("group.kelola"),
      icon: "🧰",
      items: [
        { href: "/infra", label: t_("nav.infra"), icon: "🧱", show: at?.canInfra ?? false },
        { href: "/accounts", label: t_("nav.accounts"), icon: "🔑", show: at?.canAccounts ?? false },
        { href: "/dbbackup", label: t_("nav.dbbackup"), icon: "💾", show: at?.canBackupDb ?? false },
        { href: "/dirclone", label: t_("nav.dirclone"), icon: "📦", show: at?.canBackupDb ?? false },
        { href: "/ssh", label: t_("nav.ssh"), icon: "🔐", show: at?.canSsh ?? false },
        { href: "/approvals", label: t_("nav.approvals"), icon: "🛡️", show: at?.canManage ?? false },
        { href: "/sshcmd", label: t_("nav.sshcmd"), icon: "⌨️", show: at?.canSsh ?? false },
      ],
    },
    {
      label: t_("group.keuangan"),
      icon: "💰",
      items: [
        { href: "/billing", label: t_("nav.billing"), icon: "💰", show: at?.canViewBilling ?? false },
        { href: "/cost", label: t_("nav.cost"), icon: "📉", show: at?.canViewCost ?? false },
        { href: "/reports/financial", label: t_("nav.reports"), icon: "📊", show: at?.canViewReports ?? false },
      ],
    },
    {
      label: t_("group.sistem"),
      icon: "⚙️",
      items: [
        { href: "/notifications", label: t_("nav.notifications"), icon: "🔔", show: at?.canNotify ?? false },
        { href: "/healthchecks", label: t_("nav.health"), icon: "🩺", show: at?.canInfra ?? false },
        { href: "/logs", label: t_("nav.logs"), icon: "📜", show: true },
        { href: "/teams", label: t_("nav.teams"), icon: "👥", show: true },
        { href: "/superadmin", label: t_("nav.superadmin"), icon: "⚡", show: superAdmin },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show) }))
    .filter((g) => g.items.length > 0);

  const sidebar = me?.uiLayout === "sidebar";

  /* ---------- potongan bersama ---------- */
  const impBanner = impBy && (
    <div className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-xs font-medium text-amber-950">
      🎭 {t_("imp.banner")} <b>{me?.name}</b>
      <button onClick={stopImpersonate} className="rounded-md bg-amber-950/20 px-2.5 py-0.5 font-semibold transition hover:bg-amber-950/30">
        {t_("imp.back")} {impBy.name}
      </button>
    </div>
  );

  const themeBtn = (
    <button
      onClick={toggleTheme}
      title={dark ? t_("theme.light") : t("theme.dark")}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-base transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );

  const langBtn = (
    <button
      onClick={() => setLang(lang === "id" ? "en" : "id")}
      title={`${t_("lang.title")}: ${t_(`lang.${lang}`)}`}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-[11px] font-bold text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
    >
      {lang === "id" ? "ID" : "EN"}
    </button>
  );

  const collapseBtn = (
    <button
      onClick={() => {
        const next = !collapsed;
        setCollapsed(next);
        try {
          localStorage.setItem("depanel_sidebar_collapsed", next ? "1" : "0");
        } catch {
          /* ignore */
        }
      }}
      title={collapsed ? t_("sidebar.expand") : t_("sidebar.collapse")}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-xs text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
    >
      {collapsed ? "»" : "«"}
    </button>
  );

  const avatar = me && (
    <Link
      href="/profile"
      title="Profil saya"
      className={`flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 transition hover:ring-2 hover:ring-indigo-300 dark:bg-indigo-950 dark:text-indigo-400 ${
        pathname === "/profile" ? "ring-2 ring-indigo-400" : ""
      }`}
    >
      {me.name.slice(0, 1).toUpperCase()}
    </Link>
  );

  const linkCls = (active: boolean, vertical = false) =>
    `rounded-lg text-sm font-medium transition ${vertical ? "flex items-center gap-2.5 px-3 py-2" : "px-3 py-1.5"} ${
      active
        ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
        : "text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200"
    }`;

  const burger = (
    <button
      onClick={() => setMenuOpen(!menuOpen)}
      aria-label="Buka menu"
      aria-expanded={menuOpen}
      className="flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-[5px] rounded-lg border border-slate-200 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 md:hidden"
    >
      <span className={`h-0.5 w-4 rounded bg-slate-600 transition-transform duration-200 dark:bg-slate-300 ${menuOpen ? "translate-y-[7px] rotate-45" : ""}`} />
      <span className={`h-0.5 w-4 rounded bg-slate-600 transition-opacity duration-200 dark:bg-slate-300 ${menuOpen ? "opacity-0" : ""}`} />
      <span className={`h-0.5 w-4 rounded bg-slate-600 transition-transform duration-200 dark:bg-slate-300 ${menuOpen ? "-translate-y-[7px] -rotate-45" : ""}`} />
    </button>
  );

  const mobileDropdown = (
    <div
      className={`overflow-hidden border-slate-200/80 transition-all duration-300 dark:border-slate-800/80 md:hidden ${
        menuOpen ? "max-h-[28rem] border-t" : "max-h-0"
      }`}
    >
      <nav className="flex flex-col gap-1 px-3 py-3">
        {navGroups.map((g) => (
          <div key={g.label ?? "utama"} className="mb-1">
            {g.label && (
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{g.label}</p>
            )}
            {g.items.map((l) => (
              <Link key={l.href} href={l.href} className={linkCls(pathname === l.href, true)}>
                <span>{l.icon}</span> {l.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );

  /* ---------- SIDEBAR (desktop) ---------- */
  if (sidebar) {
    return (
      <>
        {impBanner}
        {/* topbar mobile */}
        <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/80 md:hidden">
          <div className="flex items-center gap-2 px-3 py-3">
            {burger}
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-sm text-white dark:bg-slate-100 dark:text-slate-900">⚡</span>
            <div className="ml-auto flex items-center gap-1.5">
              {activeTeam && <TeamSwitcher activeTeam={activeTeam} teams={teams} compact onSwitch={switchTeam} />}
              {themeBtn}
              {avatar}
            </div>
          </div>
          {mobileDropdown}
        </header>

        <div className="flex min-h-screen">
          {/* sidebar desktop */}
          <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200/80 bg-white/60 px-3 py-4 transition-all duration-300 dark:border-slate-800/80 dark:bg-slate-950/60 md:flex ${collapsed ? "w-[68px]" : "w-60"}`}>
            <div className={`flex items-center gap-2 font-semibold tracking-tight text-slate-900 dark:text-slate-100 ${collapsed ? "justify-center" : "px-2"}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm text-white dark:bg-slate-100 dark:text-slate-900">⚡</span>
              {!collapsed && <span>Depanel</span>}
              {!collapsed && <span className="ml-auto">{collapseBtn}</span>}
            </div>
            {collapsed && (
              <div className="mt-4 flex justify-center">{collapseBtn}</div>
            )}

            <nav className={`mt-6 flex flex-col gap-1 ${collapsed ? "items-center" : ""}`}>
              {navGroups.map((g) => (
                <div key={g.label ?? "utama"} className="mb-1 w-full">
                  {g.label && !collapsed && (
                    <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{g.label}</p>
                  )}
                  {g.items.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      title={collapsed ? l.label : undefined}
                      className={`${linkCls(pathname === l.href, true)} ${collapsed ? "justify-center !px-0" : ""}`}
                    >
                      <span className={`${collapsed ? "" : "text-base"}`}>{l.icon}</span>
                      {!collapsed && l.label}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>

            {/* grup kiri-bawah: tim, user (baris 1), aksi (baris 2) */}
            <div className={`mt-auto space-y-2 border-t border-slate-200/80 pt-3 dark:border-slate-800/80 ${collapsed ? "flex flex-col items-center" : ""}`}>
              {activeTeam && <TeamSwitcher activeTeam={activeTeam} teams={teams} dropUp mini={collapsed} onSwitch={switchTeam} />}
              {!collapsed && (
                <Link
                  href="/profile"
                  title={t_("profile.title")}
                  className="flex items-center gap-2 rounded-lg px-1 py-1 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  {avatar}
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">{me?.name}</span>
                </Link>
              )}
              <div className={`flex items-center gap-1.5 ${collapsed ? "flex-col" : "justify-between"}`}>
                <div className="flex items-center gap-1.5">
                  <BellNotif dropUp />
                  {langBtn}
                  {themeBtn}
                </div>
                <button
                  onClick={logout}
                  title={t_("logout.title")}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-sm text-slate-500 transition hover:bg-slate-50 hover:text-red-500 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  ⏻
                </button>
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
        </div>
      </>
    );
  }

  /* ---------- TOPBAR (default) ---------- */
  return (
    <>
      {impBanner}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-3 sm:gap-4 sm:px-4">
          {burger}
          <span className="flex shrink-0 items-center gap-2 font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-sm text-white dark:bg-slate-100 dark:text-slate-900">⚡</span>
            <span className="hidden lg:inline">Depanel</span>
          </span>

          <nav className="hidden gap-1 md:flex">
            {navGroups.map((g) =>
              g.label === null ? (
                g.items.map((l) => (
                  <Link key={l.href} href={l.href} className={linkCls(pathname === l.href)}>
                    <span className="mr-1 text-[13px]">{l.icon}</span>
                    {l.label}
                  </Link>
                ))
              ) : (
                <NavDropdown key={g.label} label={g.label} icon={g.icon} items={g.items} pathname={pathname} />
              ),
            )}
          </nav>

          {/* kanan: switcher tim (ringkas) · bahasa · tema · profil · keluar */}
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 text-sm sm:gap-2">
            {activeTeam && <TeamSwitcher activeTeam={activeTeam} teams={teams} compact onSwitch={switchTeam} />}
            <BellNotif />
            {langBtn}
            {themeBtn}
            {avatar}
            <button
              onClick={logout}
              title={t_("logout.title")}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-sm text-slate-500 transition hover:bg-slate-50 hover:text-red-500 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              ⏻
            </button>
          </div>
        </div>
        {mobileDropdown}
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
