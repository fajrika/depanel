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

const apSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi").default("Access Point"),
  ssid: z.string().max(32).optional().nullable(),
  heightM: z.coerce.number().min(0.5).max(10).default(2.5),
  posX: z.coerce.number(),
  posY: z.coerce.number(),
  enabled: z.boolean().default(true),
  radios: z.array(radioSchema).max(3).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });
  const parsed = apSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;
  const radios = d.radios && d.radios.length > 0 ? d.radios : [{ band: "BAND_2_4" as const, channel: 1, channelWidth: 20, txPowerDbm: 20, antennaGainDbi: 3, antennaType: "OMNIDIRECTIONAL" as const, azimuthDeg: null, enabled: true }];

  const ap = await prisma.$transaction(async (tx) => {
    const created = await tx.wifiAccessPoint.create({
      data: {
        projectId: id,
        name: d.name,
        ssid: d.ssid ?? null,
        heightM: d.heightM,
        posX: d.posX,
        posY: d.posY,
        enabled: d.enabled,
        radios: {
          create: radios.map((r) => ({
            band: r.band,
            channel: r.channel,
            channelWidth: r.channelWidth,
            txPowerDbm: r.txPowerDbm,
            antennaGainDbi: r.antennaGainDbi,
            antennaType: r.antennaType,
            azimuthDeg: r.azimuthDeg ?? null,
            enabled: r.enabled,
          })),
        },
      },
      include: { radios: true },
    });
    return created;
  });
  return NextResponse.json({ ok: true, data: ap });
}