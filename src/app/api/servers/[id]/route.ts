import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { logActivity, clientForAccount } from "@/lib/power";

const patchSchema = z.object({
  managed: z.boolean().optional(),
  isProduction: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const target = await prisma.server.findUnique({
    where: { id },
    select: { account: { select: { teamId: true } } },
  });
  if (!target?.account.teamId) return NextResponse.json({ ok: false, message: "Server tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, target.account.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim yang boleh mengubah flag server" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });

  const server = await prisma.server.update({
    where: { id },
    data: parsed.data,
  });
  await logActivity({
    teamId: target.account.teamId,
    userId: user.id,
    serverId: server.id,
    action: "flags-update",
    source: "web",
    message: `managed=${server.managed} production=${server.isProduction} @ ${server.hostname}`,
  });
  return NextResponse.json({
    ok: true,
    data: { managed: server.managed, isProduction: server.isProduction },
  });
}

const delSchema = z.object({ remove_ip: z.boolean().default(false), remove_block_storage: z.boolean().default(false) });

/** Delete the instance at depa (owner/admin only). Very destructive. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const server = await prisma.server.findUnique({
    where: { id },
    include: { account: { select: { teamId: true } } },
  });
  if (!server?.account.teamId) return NextResponse.json({ ok: false, message: "Server tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, server.account.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }
  if (server.isProduction) {
    return NextResponse.json({ ok: false, message: "Server production tidak bisa dihapus (lepas flag production dulu)" }, { status: 400 });
  }

  const parsed = delSchema.safeParse(await request.json().catch(() => ({})));
  const opts = parsed.success ? parsed.data : { remove_ip: false, remove_block_storage: false };
  try {
    const client = await clientForAccount(server.accountId);
    await client.instanceDelete(server.uuid, opts);
    await prisma.server.delete({ where: { id } }).catch(() => null);
    await logActivity({ teamId: server.account.teamId, userId: user.id, action: "instance-delete", message: `Hapus instance ${server.hostname}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
