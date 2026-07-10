import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canTouchServer } from "@/lib/team";
import { logActivity } from "@/lib/power";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await canTouchServer(user.id, id))) {
    return NextResponse.json({ ok: false, message: "Anda tidak punya akses ke server ini" }, { status: 403 });
  }
  const schedule = await prisma.schedule.findUnique({
    where: { serverId: id },
    include: { actions: true },
  });
  return NextResponse.json({
    ok: true,
    data: schedule ?? { enabled: false, timezone: "Asia/Jakarta", actions: [] },
  });
}

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const actionSchema = z.object({
  days: z.string().regex(/^[0-6](,[0-6])*$/, "Pilih minimal satu hari"),
  time: z.string().regex(timeRe, "Format jam HH:MM"),
  action: z.enum(["start", "stop"]),
});
const putSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().min(1),
  actions: z.array(actionSchema).max(40),
});

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await canTouchServer(user.id, id, "schedule"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin mengatur jadwal di tim ini" }, { status: 403 });
  }
  const server = await prisma.server.findUnique({ where: { id } });
  if (!server) return NextResponse.json({ ok: false, message: "Server tidak ditemukan" }, { status: 404 });

  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const { enabled, timezone, actions } = parsed.data;

  await prisma.schedule.upsert({
    where: { serverId: id },
    create: { serverId: id, enabled, timezone, actions: { create: actions } },
    update: { enabled, timezone, actions: { deleteMany: {}, create: actions } },
  });
  await logActivity({
    userId: user.id,
    serverId: id,
    action: "schedule-update",
    source: "web",
    message: `enabled=${enabled} tz=${timezone} aksi=${actions.length} @ ${server.hostname}`,
  });

  const fresh = await prisma.schedule.findUnique({ where: { serverId: id }, include: { actions: true } });
  return NextResponse.json({ ok: true, data: fresh });
}
