import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";

/** Returns ALL servers for a specific account (regardless of isActive), for the accounts management page. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const account = await prisma.depaAccount.findUnique({
    where: { id },
    select: { teamId: true },
  });
  if (!account?.teamId) return NextResponse.json({ ok: false, message: "Akun tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, account.teamId, "accounts"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin" }, { status: 403 });
  }

  const servers = await prisma.server.findMany({
    where: { accountId: id },
    orderBy: [{ sortOrder: "asc" }, { hostname: "asc" }],
    select: {
      id: true,
      uuid: true,
      hostname: true,
      status: true,
      isActive: true,
      ipAddress: true,
      location: true,
      account: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ ok: true, data: servers });
}
