// Definisi menu navigasi bersama (dipakai AppShell & halaman Profil untuk pengaturan menu).

export type NavItem = { href: string; label: string; icon: string };
export type NavGroup = { key: string; label: string | null; icon: string; items: NavItem[] };

/** Izin tim yang menentukan menu mana yang boleh tampil. */
export type NavPerms = Partial<{
  canViewBilling: boolean;
  canViewCost: boolean;
  canViewReports: boolean;
  canBackupDb: boolean;
  canSsh: boolean;
  canInfra: boolean;
  canAccounts: boolean;
  canNotify: boolean;
  canManage: boolean;
  canWifi: boolean;
}>;

/** Menu yang selalu tampil di menu utama (tidak bisa dipindah ke "Lainnya"). */
export const PINNED_NAV = new Set(["/"]);

/** Key grup khusus untuk menu yang disembunyikan pengguna. */
export const OTHER_GROUP_KEY = "lainnya";

export function buildNavGroups(t: (k: string) => string, at: NavPerms | null | undefined, superAdmin: boolean): NavGroup[] {
  const groups: { key: string; label: string | null; icon: string; items: (NavItem & { show: boolean })[] }[] = [
    {
      key: "utama",
      label: null,
      icon: "",
      items: [
        { href: "/", label: t("nav.server"), icon: "🖥️", show: true },
        { href: "/reports", label: t("nav.laporan"), icon: "📑", show: true },
      ],
    },
    {
      key: "kelola",
      label: t("group.kelola"),
      icon: "🧰",
      items: [
        { href: "/infra", label: t("nav.infra"), icon: "🧱", show: at?.canInfra ?? false },
        { href: "/accounts", label: t("nav.accounts"), icon: "🔑", show: at?.canAccounts ?? false },
        { href: "/dbbackup", label: t("nav.dbbackup"), icon: "💾", show: at?.canBackupDb ?? false },
        { href: "/dirclone", label: t("nav.dirclone"), icon: "📦", show: at?.canBackupDb ?? false },
        { href: "/ssh", label: t("nav.ssh"), icon: "🔐", show: at?.canSsh ?? false },
        { href: "/sshhealth", label: t("nav.sshhealth"), icon: "🧪", show: at?.canSsh ?? false },
        { href: "/approvals", label: t("nav.approvals"), icon: "🛡️", show: at?.canManage ?? false },
        { href: "/sshcmd", label: t("nav.sshcmd"), icon: "⌨️", show: at?.canSsh ?? false },
        { href: "/wifi/projects", label: t("nav.wifi"), icon: "📶", show: at?.canWifi ?? false },
      ],
    },
    {
      key: "keuangan",
      label: t("group.keuangan"),
      icon: "💰",
      items: [
        { href: "/billing", label: t("nav.billing"), icon: "💰", show: at?.canViewBilling ?? false },
        { href: "/cost", label: t("nav.cost"), icon: "📉", show: at?.canViewCost ?? false },
        { href: "/reports/financial", label: t("nav.reportsFinancial"), icon: "📊", show: at?.canViewReports ?? false },
      ],
    },
    {
      key: "sistem",
      label: t("group.sistem"),
      icon: "⚙️",
      items: [
        { href: "/notifications", label: t("nav.notifications"), icon: "🔔", show: at?.canNotify ?? false },
        { href: "/healthchecks", label: t("nav.health"), icon: "🩺", show: at?.canInfra ?? false },
        { href: "/logs", label: t("nav.logs"), icon: "📜", show: true },
        { href: "/panelbackup", label: t("nav.panelbackup"), icon: "🗄️", show: true },
        { href: "/teams", label: t("nav.teams"), icon: "👥", show: true },
        { href: "/superadmin", label: t("nav.superadmin"), icon: "⚡", show: superAdmin },
      ],
    },
  ];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show).map((i) => ({ href: i.href, label: i.label, icon: i.icon })) }))
    .filter((g) => g.items.length > 0);
}

/** Parse kolom User.navHidden (JSON array href). Nilai rusak/kosong → []. */
export function parseNavHidden(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Pindahkan menu yang disembunyikan pengguna ke grup "Lainnya" (paling akhir).
 * Tanpa menu tersembunyi, susunan menu sama persis seperti default.
 */
export function applyNavHidden(groups: NavGroup[], hidden: string[], otherLabel: string): NavGroup[] {
  const hide = new Set(hidden.filter((h) => !PINNED_NAV.has(h)));
  if (hide.size === 0) return groups;
  const other: NavItem[] = [];
  const main = groups
    .map((g) => {
      const keep: NavItem[] = [];
      for (const i of g.items) (hide.has(i.href) ? other : keep).push(i);
      return { ...g, items: keep };
    })
    .filter((g) => g.items.length > 0);
  if (other.length > 0) main.push({ key: OTHER_GROUP_KEY, label: otherLabel, icon: "⋯", items: other });
  return main;
}
