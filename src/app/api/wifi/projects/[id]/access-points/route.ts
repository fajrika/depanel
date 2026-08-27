import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi, ownWifiProject } from "@/lib/wifi";

const apSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi").default("Access Point"),
  ssid: z.string().max(32).optional().nullable(),
  band: z.enum(["BAND_2_4", "BAND_5", "BAND_6"]).default("BAND_2_4"),
  channel: z.coerce.number().int().min(1).max(233).default(1),
  channelWidth: z.coerce.number().int().refine((v) => [20, 40, 80, 160].includes(v), "Channel width tidak valid").default(20),
  txPowerDbm: z.coerce.number().min(0).max(30).default(20),
  antennaGainDbi: z.coerce.number().min(0).max(20).default(3),
  antennaType: z.enum(["OMNIDIRECTIONAL", "PATCH", "PANEL"]).default("OMNIDIRECTIONAL"),
  azimuthDeg: z.coerce.number().int().min(0).max(360).optional().nullable(),
  heightM: z.coerce.number().min(0.5).max(10).default(2.5),
  posX: z.coerce.number(),
  posY: z.coerce.number(),
  enabled: z.boolean().default(true),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { team } = await requireWifi();
  const { id } = await ctx.params;
  await ownWifiProject(team.id, id);
  const parsed = apSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;
  const ap = await prisma.wifiAccessPoint.create({
    data: {
      projectId: id,
      name: d.name,
      ssid: d.ssid ?? null,
      band: d.band,
      channel: d.channel,
      channelWidth: d.channelWidth,
      txPowerDbm: d.txPowerDbm,
      antennaGainDbi: d.antennaGainDbi,
      antennaType: d.antennaType,
      azimuthDeg: d.azimuthDeg ?? null,
      heightM: d.heightM,
      posX: d.posX,
      posY: d.posY,
      enabled: d.enabled,
    },
  });
  return NextResponse.json({ ok: true, data: ap });
}
