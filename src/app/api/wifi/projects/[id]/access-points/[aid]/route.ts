import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi, ownWifiProject } from "@/lib/wifi";

const apSchema = z.object({
  name: z.string().min(1).optional(),
  ssid: z.string().max(32).optional().nullable(),
  band: z.enum(["BAND_2_4", "BAND_5", "BAND_6"]).optional(),
  channel: z.coerce.number().int().min(1).max(233).optional(),
  channelWidth: z.coerce.number().int().refine((v) => [20, 40, 80, 160].includes(v), "Channel width tidak valid").optional(),
  txPowerDbm: z.coerce.number().min(0).max(30).optional(),
  antennaGainDbi: z.coerce.number().min(0).max(20).optional(),
  antennaType: z.enum(["OMNIDIRECTIONAL", "PATCH", "PANEL"]).optional(),
  azimuthDeg: z.coerce.number().int().min(0).max(360).optional().nullable(),
  heightM: z.coerce.number().min(0.5).max(10).optional(),
  posX: z.coerce.number().optional(),
  posY: z.coerce.number().optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string; aid: string }> }) {
  const { team } = await requireWifi();
  const { id, aid } = await ctx.params;
  await ownWifiProject(team.id, id);
  const parsed = apSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const ap = await prisma.wifiAccessPoint.findFirst({ where: { id: aid, projectId: id } });
  if (!ap) return NextResponse.json({ ok: false, message: "Access point tidak ditemukan" }, { status: 404 });
  const updated = await prisma.wifiAccessPoint.update({ where: { id: aid }, data: parsed.data });
  return NextResponse.json({ ok: true, data: updated });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string; aid: string }> }) {
  const { team } = await requireWifi();
  const { id, aid } = await ctx.params;
  await ownWifiProject(team.id, id);
  const ap = await prisma.wifiAccessPoint.findFirst({ where: { id: aid, projectId: id } });
  if (!ap) return NextResponse.json({ ok: false, message: "Access point tidak ditemukan" }, { status: 404 });
  await prisma.wifiAccessPoint.delete({ where: { id: aid } });
  return NextResponse.json({ ok: true });
}
