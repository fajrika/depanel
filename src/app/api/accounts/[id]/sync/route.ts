import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { membershipOf } from "@/lib/team";
import { syncAccount, logActivity } from "@/lib/power";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const account = await prisma.depaAccount.findUnique({ where: { id } });
  if (!account?.teamId) return NextResponse.json({ ok: false, message: "Akun tidak ditemukan" }, { status: 404 });
  if (!(await membershipOf(user.id, account.teamId))) {
    return NextResponse.json({ ok: false, message: "Anda bukan anggota tim ini" }, { status: 403 });
  }

  try {
    const synced = await syncAccount(id);
    await logActivity({ teamId: account.teamId, userId: user.id, action: "sync", message: `sync akun: ${synced} server` });
    return NextResponse.json({ ok: true, data: { synced } });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
