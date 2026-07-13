// Shared guard for per-server depa passthrough routes (route handlers only).
import { NextResponse } from "next/server";
import { prisma } from "./db";
import { staffOf, canTouchServer } from "./team";
import { clientForAccount, type PowerAction } from "./power";
import type { DepaClient } from "./depa";
import { getCurrentUser } from "./auth";

void ({} as PowerAction); // keep type import tree-shakeable

export type ServerCtx = {
  user: { id: string; name: string; email: string; role: string };
  server: { id: string; uuid: string; hostname: string; accountId: string; teamId: string };
  client: DepaClient;
};

/**
 * Resolve the current user + server + a depa client, enforcing access.
 * staffOnly=true requires owner/admin of the server's team (for destructive ops).
 * Otherwise any member with access (respecting hidden servers / need permission).
 */
export async function serverCtx(
  serverId: string,
  opts: { staffOnly?: boolean; need?: "schedule" | "backup" } = {},
): Promise<ServerCtx | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const s = await prisma.server.findUnique({
    where: { id: serverId },
    select: { id: true, uuid: true, hostname: true, accountId: true, account: { select: { teamId: true } } },
  });
  if (!s?.account.teamId) return NextResponse.json({ ok: false, message: "Server tidak ditemukan" }, { status: 404 });

  if (opts.staffOnly) {
    if (!(await staffOf(user.id, s.account.teamId))) {
      return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
    }
  } else if (!(await canTouchServer(user.id, serverId, opts.need))) {
    return NextResponse.json({ ok: false, message: "Anda tidak punya akses ke server ini" }, { status: 403 });
  }

  const client = await clientForAccount(s.accountId);
  return { user, server: { id: s.id, uuid: s.uuid, hostname: s.hostname, accountId: s.accountId, teamId: s.account.teamId }, client };
}

/** Resolve an account + client, requiring the user to be owner/admin of the account's team. */
export async function accountStaffCtx(accountId: string): Promise<{ user: { id: string }; teamId: string; client: DepaClient } | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const acc = await prisma.depaAccount.findUnique({ where: { id: accountId }, select: { teamId: true } });
  if (!acc?.teamId) return NextResponse.json({ ok: false, message: "Akun tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, acc.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }
  const client = await clientForAccount(accountId);
  return { user: { id: user.id }, teamId: acc.teamId, client };
}
