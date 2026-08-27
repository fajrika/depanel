import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi, ownWifiProject } from "@/lib/wifi";

const apSchema = z.object({
  name: z.string().min(1).optional(),
  ssid: z.string().max(32).optional().nullable(),
  heightM: z.coerce.number().min(0.5).max(10).optional(),
  posX: z.coerce.number().optional(),
  posY: z.coerce.number().optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string; aid: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id, aid } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });
  const parsed = apSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const ap = await prisma.wifiAccessPoint.findFirst({ where: { id: aid, projectId: id } });
  if (!ap) return NextResponse.json({ ok: false, message: "Access point tidak ditemukan" }, { status: 404 });
  const updated = await prisma.wifiAccessPoint.update({
    where: { id: aid },
    data: parsed.data,
    include: { radios: true },
  });
  return NextResponse.json({ ok: true, data: updated });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string; aid: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id, aid } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });
  const ap = await prisma.wifiAccessPoint.findFirst({ where: { id: aid, projectId: id } });
  if (!ap) return NextResponse.json({ ok: false, message: "Access point tidak ditemukan" }, { status: 404 });
  await prisma.wifiAccessPoint.delete({ where: { id: aid } });
  return NextResponse.json({ ok: true });
}