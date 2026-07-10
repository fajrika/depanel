import { NextResponse } from "next/server";
import { z } from "zod";
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

const patchSchema = z.object({
  retention: z.number().int().min(1).max(30).optional(),
  schedule_type: z.enum(["daily", "weekly"]).optional(),
  schedule_at: z.number().int().min(0).max(23).optional(),
  schedule_on: z.number().int().min(0).max(7).optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string; schedId: string }> }) {
  const { id, schedId } = await ctx.params;
  const g = await guard(id);
  if ("err" in g) return g.err;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });

  try {
    const client = await clientForAccount(g.server.accountId);
    const data = await client.backupScheduleUpdate(g.server.uuid, schedId, parsed.data);
    await logActivity({
      userId: g.user.id,
      serverId: id,
      action: "backup-schedule-update",
      message: `Ubah jadwal backup ${schedId} @ ${g.server.hostname}`,
    });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; schedId: string }> }) {
  const { id, schedId } = await ctx.params;
  const g = await guard(id);
  if ("err" in g) return g.err;
  try {
    const client = await clientForAccount(g.server.accountId);
    const data = await client.backupScheduleDelete(g.server.uuid, schedId);
    await logActivity({
      userId: g.user.id,
      serverId: id,
      action: "backup-schedule-delete",
      message: `Hapus jadwal backup ${schedId} @ ${g.server.hostname}`,
    });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
