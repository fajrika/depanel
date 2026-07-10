// Workspace layer: resolve the active team from a cookie, with self-healing
// personal-team creation. Import only from route handlers (uses next/headers).
//
// Hirarki peran per tim:
//   owner  — tepat satu; kontrol penuh + transfer ownership + kick admin
//   admin  — ditunjuk owner; kelola API key, member, izin, urutan & visibilitas server
//   member — pantau/kendalikan server yang boleh dia lihat, sesuai izin per-member
import "server-only";
import { cookies } from "next/headers";
import { prisma } from "./db";

export const TEAM_COOKIE = "depa_team";

export type TeamRole = "owner" | "admin" | "member";

/** owner/admin = staf pengelola tim */
export function isStaff(role: TeamRole | string): boolean {
  return role === "owner" || role === "admin";
}

export interface ActiveTeam {
  id: string;
  name: string;
  isPersonal: boolean;
  role: TeamRole;
  canViewBilling: boolean;
  canSchedule: boolean;
  canBackup: boolean;
}

/** Pastikan user punya tim pribadi; buat kalau belum ada. */
export async function ensurePersonalTeam(userId: string, userName: string) {
  const existing = await prisma.team.findFirst({
    where: { isPersonal: true, members: { some: { userId } } },
  });
  if (existing) return existing;
  return prisma.team.create({
    data: {
      name: `Pribadi — ${userName}`,
      isPersonal: true,
      members: { create: { userId, role: "owner", canViewBilling: true } },
    },
  });
}

/** Semua tim milik user (pribadi dulu, lalu alfabetis). */
export async function getMyTeams(userId: string) {
  const memberships = await prisma.teamMember.findMany({
    where: { userId },
    include: { team: { include: { _count: { select: { members: true, accounts: true } } } } },
  });
  return memberships
    .map((m) => ({
      id: m.team.id,
      name: m.team.name,
      isPersonal: m.team.isPersonal,
      role: m.role as TeamRole,
      canViewBilling: isStaff(m.role) || m.canViewBilling,
      memberCount: m.team._count.members,
      accountCount: m.team._count.accounts,
    }))
    .sort((a, b) => (a.isPersonal === b.isPersonal ? a.name.localeCompare(b.name) : a.isPersonal ? -1 : 1));
}

function toActiveTeam(m: { role: string; canViewBilling: boolean; canSchedule: boolean; canBackup: boolean }, team: { id: string; name: string; isPersonal: boolean }): ActiveTeam {
  const staff = isStaff(m.role);
  return {
    id: team.id,
    name: team.name,
    isPersonal: team.isPersonal,
    role: m.role as TeamRole,
    canViewBilling: staff || m.canViewBilling,
    canSchedule: staff || m.canSchedule,
    canBackup: staff || m.canBackup,
  };
}

/**
 * Tim aktif: cookie `depa_team` → tim terakhir yang tersimpan di akun (lastTeamId)
 * → tim pribadi (dibuat otomatis bila hilang). Jadi login dari device baru pun
 * langsung kembali ke tim terakhir yang dipakai.
 */
export async function getActiveTeam(user: { id: string; name: string; lastTeamId?: string | null }): Promise<ActiveTeam> {
  const c = await cookies();
  const candidates = [c.get(TEAM_COOKIE)?.value, user.lastTeamId].filter(Boolean) as string[];

  for (const teamId of candidates) {
    const m = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: user.id } },
      include: { team: true },
    });
    if (m) return toActiveTeam(m, m.team);
  }

  const personal = await ensurePersonalTeam(user.id, user.name);
  return {
    id: personal.id,
    name: personal.name,
    isPersonal: personal.isPersonal,
    role: "owner",
    canViewBilling: true,
    canSchedule: true,
    canBackup: true,
  };
}

/** Membership user pada tim tertentu, atau null. */
export async function membershipOf(userId: string, teamId: string) {
  return prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
}

/** Membership bila user berperan owner/admin di tim itu; selain itu null. */
export async function staffOf(userId: string, teamId: string) {
  const m = await membershipOf(userId, teamId);
  return m && isStaff(m.role) ? m : null;
}

/**
 * Boleh menyentuh server ini?
 * - harus anggota tim pemilik server
 * - member tidak boleh bila server disembunyikan darinya
 * - need "schedule"/"backup": member butuh izin terkait (staf selalu boleh)
 */
export async function canTouchServer(
  userId: string,
  serverId: string,
  need?: "schedule" | "backup",
): Promise<boolean> {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { account: { select: { teamId: true } } },
  });
  if (!server?.account.teamId) return false;
  const m = await membershipOf(userId, server.account.teamId);
  if (!m) return false;
  if (isStaff(m.role)) return true;

  const hidden = await prisma.memberServerHide.findUnique({
    where: { memberId_serverId: { memberId: m.id, serverId } },
  });
  if (hidden) return false;

  if (need === "schedule" && !m.canSchedule) return false;
  if (need === "backup" && !m.canBackup) return false;
  return true;
}
