"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Me = { id: string; name: string; email: string; role: string; uiLayout: string };
type TeamInfo = { id: string; name: string; isPersonal: boolean; role: string; canViewBilling: boolean };

/* ---------- switcher tim (dipakai topbar & sidebar) ---------- */
function TeamSwitcher({
  activeTeam,
  teams,
  compact,
  dropUp,
  onSwitch,
}: {
  activeTeam: TeamInfo;
  teams: TeamInfo[];
  compact?: boolean; // versi ringkas untuk topbar
  dropUp?: boolean; // dropdown membuka ke atas (sidebar kiri-bawah)
  onSwitch: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative min-w-0">
      <button
        onClick={() => setOpen(!open)}
        title={`Tim aktif: ${activeTeam.name}`}
        className={`flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 ${
          compact ? "h-8 max-w-[140px] px-2 py-1 text-xs sm:max-w-[180px]" : "w-full px-2.5 py-2"
        }`}
      >
        <span className="shrink-0">{activeTeam.isPersonal ? "👤" : "👥"}</span>
        <span className="min-w-0 flex-1 truncate text-left">{activeTeam.name}</span>
        <span className={`shrink-0 text-[9px] text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`animate-fade-up absolute z-50 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900 ${
              dropUp ? "bottom-full left-0 mb-1.5" : "right-0 top-full mt-1.5"
            }`}
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Pilih tim</p>
            {teams.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setOpen(false);
                  onSwitch(t.id);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                  t.id === activeTeam.id
                    ? "bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                    : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60"
                }`}
              >
                <span>{t.isPersonal ? "👤" : "👥"}</span>
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {t.role}
                </span>
                {t.id === activeTeam.id && <span className="shrink-0 text-emerald-500">✓</span>}
              </button>
            ))}
            <div className="mt-1 border-t border-slate-100 pt-1 dark:border-slate-800">
              <Link
                href="/teams"
                onClick={() => setOpen(false)}
                className="block rounded-lg px-2.5 py-2 text-sm text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
              >
                + Kelola / buat tim
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type NavItem = { href: string; label: string; icon: string };

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
  const [me, setMe] = useState<Me | null>(null);
  const [activeTeam, setActiveTeam] = useState<TeamInfo | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [impBy, setImpBy] = useState<{ id: string; name: string } | null>(null);
  const [dark, setDark] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
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

  const staff = activeTeam ? activeTeam.role === "owner" || activeTeam.role === "admin" : false;
  const billing = activeTeam?.canViewBilling ?? false;

  // Menu dikelompokkan agar rapih. Grup dengan label tampil sebagai dropdown (topbar)
  // atau seksi berjudul (sidebar/mobile). Grup tanpa label = tautan langsung.
  const navGroups: { label: string | null; icon: string; items: (NavItem & { show: boolean })[] }[] = [
    { label: null, icon: "", items: [{ href: "/", label: "Server", icon: "🖥️", show: true }] },
    {
      label: "Kelola",
      icon: "🧰",
      items: [
        { href: "/infra", label: "Infra", icon: "🧱", show: staff },
        { href: "/accounts", label: "Akun API", icon: "🔑", show: staff },
        { href: "/dbbackup", label: "Backup DB", icon: "💾", show: staff },
      ],
    },
    {
      label: "Keuangan",
      icon: "💰",
      items: [
        { href: "/billing", label: "Saldo", icon: "💰", show: billing },
        { href: "/cost", label: "Biaya", icon: "📉", show: billing },
        { href: "/reports/financial", label: "Laporan", icon: "📊", show: billing },
      ],
    },
    {
      label: "Sistem",
      icon: "⚙️",
      items: [
        { href: "/notifications", label: "Notifikasi", icon: "🔔", show: staff },
        { href: "/logs", label: "Log", icon: "📜", show: true },
        { href: "/teams", label: "Tim", icon: "👥", show: true },
        { href: "/superadmin", label: "Super Admin", icon: "⚡", show: superAdmin },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show) }))
    .filter((g) => g.items.length > 0);

  const sidebar = me?.uiLayout === "sidebar";

  /* ---------- potongan bersama ---------- */
  const impBanner = impBy && (
    <div className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-xs font-medium text-amber-950">
      🎭 Anda sedang menyamar sebagai <b>{me?.name}</b>
      <button onClick={stopImpersonate} className="rounded-md bg-amber-950/20 px-2.5 py-0.5 font-semibold transition hover:bg-amber-950/30">
        ← Kembali ke {impBy.name}
      </button>
    </div>
  );

  const themeBtn = (
    <button
      onClick={toggleTheme}
      title={dark ? "Mode terang" : "Mode gelap"}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-base transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
    >
      {dark ? "☀️" : "🌙"}
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
          <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200/80 bg-white/60 px-3 py-4 dark:border-slate-800/80 dark:bg-slate-950/60 md:flex">
            <span className="flex items-center gap-2 px-2 font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-sm text-white dark:bg-slate-100 dark:text-slate-900">⚡</span>
              Depanel
            </span>

            <nav className="mt-6 flex flex-col gap-1">
              {navGroups.map((g) => (
                <div key={g.label ?? "utama"} className="mb-1">
                  {g.label && (
                    <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{g.label}</p>
                  )}
                  {g.items.map((l) => (
                    <Link key={l.href} href={l.href} className={linkCls(pathname === l.href, true)}>
                      <span className="text-base">{l.icon}</span> {l.label}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>

            {/* grup kiri-bawah: tim, tema, profil, logout */}
            <div className="mt-auto space-y-2 border-t border-slate-200/80 pt-3 dark:border-slate-800/80">
              {activeTeam && <TeamSwitcher activeTeam={activeTeam} teams={teams} dropUp onSwitch={switchTeam} />}
              <div className="flex items-center gap-2 px-0.5">
                {themeBtn}
                {avatar}
                {me && <span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">{me.name}</span>}
                <button
                  onClick={logout}
                  title="Keluar"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-sm text-slate-500 transition hover:bg-slate-50 hover:text-red-500 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
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

          {/* kanan: switcher tim (ringkas) · tema · profil · keluar */}
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 text-sm sm:gap-2">
            {activeTeam && <TeamSwitcher activeTeam={activeTeam} teams={teams} compact onSwitch={switchTeam} />}
            {themeBtn}
            {avatar}
            <button
              onClick={logout}
              title="Keluar"
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
