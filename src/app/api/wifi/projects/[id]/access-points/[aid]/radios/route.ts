import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi, ownWifiProject } from "@/lib/wifi";

const radioSchema = z.object({
  band: z.enum(["BAND_2_4", "BAND_5", "BAND_6"]),
  channel: z.coerce.number().int().min(1).max(233).default(1),
  channelWidth: z.coerce.number().int().refine((v) => [20, 40, 80, 160].includes(v), "Channel width tidak valid").default(20),
  txPowerDbm: z.coerce.number().min(0).max(30).default(20),
  antennaGainDbi: z.coerce.number().min(0).max(20).default(3),
  antennaType: z.enum(["OMNIDIRECTIONAL", "PATCH", "PANEL"]).default("OMNIDIRECTIONAL"),
  azimuthDeg: z.coerce.number().int().min(0).max(360).optional().nullable(),
  enabled: z.boolean().default(true),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string; aid: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id, aid } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });
  const ap = await prisma.wifiAccessPoint.findFirst({ where: { id: aid, projectId: id } });
  if (!ap) return NextResponse.json({ ok: false, message: "Access point tidak ditemukan" }, { status: 404 });
  const parsed = radioSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;
  const dup = await prisma.wifiApRadio.findFirst({ where: { apId: aid, band: d.band } });
  if (dup) return NextResponse.json({ ok: false, message: "Band ini sudah ada di AP ini" }, { status: 400 });
  const radio = await prisma.wifiApRadio.create({
    data: { apId: aid, band: d.band, channel: d.channel, channelWidth: d.channelWidth, txPowerDbm: d.txPowerDbm, antennaGainDbi: d.antennaGainDbi, antennaType: d.antennaType, azimuthDeg: d.azimuthDeg ?? null, enabled: d.enabled },
  });
  return NextResponse.json({ ok: true, data: radio });
}