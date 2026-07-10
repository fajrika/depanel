import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canTouchServer } from "@/lib/team";
import { clientForAccount, logActivity } from "@/lib/power";

async function guard(id: string) {
  const user = await getCurrentUser();
  if (!user) return { err: NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 }) };
  if (!(await canTouchServer(user.id, id, "backup"))) {
    return { err: NextResponse.json({ ok: false, message: "Anda tidak diberi izin mengakses backup di tim ini" }, { status: 403 }) };
  }
  const server = await prisma.server.findUnique({ where: { id } });
  if (!server) return { err: NextResponse.json({ ok: false, message: "Server tidak ditemukan" }, { status: 404 }) };
  return { user, server };
}

/** POST = restore dari arsip backup ini. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; backupId: string }> }) {
  const { id, backupId } = await ctx.params;
  const g = await guard(id);
  if ("err" in g) return g.err;
  try {
    const client = await clientForAccount(g.server.accountId);
    const data = await client.backupRestore(g.server.uuid, backupId);
    await logActivity({
      userId: g.user.id,
      serverId: id,
      action: "backup-restore",
      message: `Restore backup ${backupId} @ ${g.server.hostname}`,
    });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; backupId: string }> }) {
  const { id, backupId } = await ctx.params;
  const g = await guard(id);
  if ("err" in g) return g.err;
  try {
    const client = await clientForAccount(g.server.accountId);
    const data = await client.backupDelete(g.server.uuid, backupId);
    await logActivity({
      userId: g.user.id,
      serverId: id,
      action: "backup-delete",
      message: `Hapus arsip backup ${backupId} @ ${g.server.hostname}`,
    });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
