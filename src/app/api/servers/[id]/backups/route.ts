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

/** GET → { schedules, history } dari depa dalam satu panggilan. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if ("err" in g) return g.err;
  try {
    const client = await clientForAccount(g.server.accountId);
    const [schedules, history] = await Promise.all([
      client.backupSchedules(g.server.uuid),
      client.backupHistory(g.server.uuid),
    ]);
    return NextResponse.json({ ok: true, data: { schedules, history } });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}

const createSchema = z.object({
  retention: z.number().int().min(1).max(30),
  schedule_type: z.enum(["daily", "weekly"]),
  schedule_at: z.number().int().min(0).max(23),
  schedule_on: z.number().int().min(0).max(7).optional(),
});

/** POST → buat jadwal backup otomatis di depa. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if ("err" in g) return g.err;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  try {
    const client = await clientForAccount(g.server.accountId);
    const data = await client.backupScheduleCreate(g.server.uuid, parsed.data);
    await logActivity({
      userId: g.user.id,
      serverId: id,
      action: "backup-schedule-create",
      message: `Jadwal backup ${parsed.data.schedule_type} jam ${parsed.data.schedule_at}:00, retensi ${parsed.data.retention} @ ${g.server.hostname}`,
    });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
