import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi, ownWifiProject } from "@/lib/wifi";

const radioSchema = z.object({
  band: z.enum(["BAND_2_4", "BAND_5", "BAND_6"]).optional(),
  channel: z.coerce.number().int().min(1).max(233).optional(),
  channelWidth: z.coerce.number().int().refine((v) => [20, 40, 80, 160].includes(v), "Channel width tidak valid").optional(),
  txPowerDbm: z.coerce.number().min(0).max(30).optional(),
  antennaGainDbi: z.coerce.number().min(0).max(20).optional(),
  antennaType: z.enum(["OMNIDIRECTIONAL", "PATCH", "PANEL"]).optional(),
  azimuthDeg: z.coerce.number().int().min(0).max(360).optional().nullable(),
  enabled: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string; aid: string; rid: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id, aid, rid } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });
  const parsed = radioSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const radio = await prisma.wifiApRadio.findFirst({ where: { id: rid, ap: { id: aid, projectId: id } } });
  if (!radio) return NextResponse.json({ ok: false, message: "Radio tidak ditemukan" }, { status: 404 });
  if (parsed.data.band && parsed.data.band !== radio.band) {
    const dup = await prisma.wifiApRadio.findFirst({ where: { apId: aid, band: parsed.data.band, NOT: { id: rid } } });
    if (dup) return NextResponse.json({ ok: false, message: "Band ini sudah ada di AP ini" }, { status: 400 });
  }
  const updated = await prisma.wifiApRadio.update({ where: { id: rid }, data: parsed.data });
  return NextResponse.json({ ok: true, data: updated });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string; aid: string; rid: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id, aid, rid } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });
  const radio = await prisma.wifiApRadio.findFirst({ where: { id: rid, ap: { id: aid, projectId: id } } });
  if (!radio) return NextResponse.json({ ok: false, message: "Radio tidak ditemukan" }, { status: 404 });
  await prisma.wifiApRadio.delete({ where: { id: rid } });
  return NextResponse.json({ ok: true });
}