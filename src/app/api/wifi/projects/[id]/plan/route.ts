import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi, ownWifiProject } from "@/lib/wifi";
import { logActivity } from "@/lib/power";

const MAX_FLOORS = 5;

const planSchema = z.object({
  widthM: z.coerce.number().min(1).max(200).optional(),
  heightM: z.coerce.number().min(1).max(200).optional(),
  scalePxPerM: z.coerce.number().min(5).max(100).optional(),
  pathLossExponent: z.coerce.number().min(1.5).max(6).optional(),
  deadZoneDbm: z.coerce.number().min(-100).max(-50).optional(),
  floors: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        level: z.coerce.number().int().min(1).max(99),
        heightM: z.coerce.number().min(1).max(10),
        material: z.enum(["CONCRETE", "WOOD", "GYPSUM"]),
        floorplanData: z.string().max(8_000_000).optional().nullable(),
      }),
    )
    .min(1)
    .max(MAX_FLOORS)
    .optional(),
  walls: z
    .array(
      z.object({
        floorIndex: z.coerce.number().int().min(0),
        x1: z.coerce.number(),
        y1: z.coerce.number(),
        x2: z.coerce.number(),
        y2: z.coerce.number(),
        material: z.enum(["DRYWALL", "WOOD", "GLASS", "BRICK", "CONCRETE"]),
      }),
    )
    .max(2000)
    .optional(),
  accessPoints: z
    .array(
      z.object({
        floorIndex: z.coerce.number().int().min(0),
        name: z.string().min(1).default("Access Point"),
        ssid: z.string().max(32).optional().nullable(),
        heightM: z.coerce.number().min(0.5).max(10),
        posX: z.coerce.number(),
        posY: z.coerce.number(),
        enabled: z.boolean().default(true),
        radios: z
          .array(
            z.object({
              band: z.enum(["BAND_2_4", "BAND_5", "BAND_6"]),
              channel: z.coerce.number().int().min(1).max(233),
              channelWidth: z.coerce.number().int().refine((v) => [20, 40, 80, 160].includes(v)),
              txPowerDbm: z.coerce.number().min(0).max(30),
              antennaGainDbi: z.coerce.number().min(0).max(20),
              antennaType: z.enum(["OMNIDIRECTIONAL", "PATCH", "PANEL"]),
              azimuthDeg: z.coerce.number().int().min(0).max(360).optional().nullable(),
              enabled: z.boolean().default(true),
            }),
          )
          .min(1)
          .max(3),
      }),
    )
    .max(500)
    .optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });
  const parsed = planSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Plan tidak valid" }, { status: 400 });
  }
  const d = parsed.data;

  const projectData: Record<string, unknown> = {};
  if (d.widthM !== undefined) projectData.widthM = d.widthM;
  if (d.heightM !== undefined) projectData.heightM = d.heightM;
  if (d.scalePxPerM !== undefined) projectData.scalePxPerM = d.scalePxPerM;
  if (d.pathLossExponent !== undefined) projectData.pathLossExponent = d.pathLossExponent;
  if (d.deadZoneDbm !== undefined) projectData.deadZoneDbm = d.deadZoneDbm;

  await prisma.$transaction(async (tx) => {
    await tx.wifiWall.deleteMany({ where: { projectId: id } });
    await tx.wifiAccessPoint.deleteMany({ where: { projectId: id } });
    await tx.wifiFloor.deleteMany({ where: { projectId: id } });
    await tx.wifiProject.update({ where: { id }, data: projectData });

    const floors = d.floors ?? [{ name: "Lantai 1", level: 1, heightM: 3, material: "CONCRETE" as const }];
    const floorIds: string[] = [];
    for (const f of floors) {
      const created = await tx.wifiFloor.create({
        data: { projectId: id, name: f.name, level: f.level, heightM: f.heightM, material: f.material, floorplanData: f.floorplanData ?? null },
      });
      floorIds.push(created.id);
    }

    if (d.walls && d.walls.length > 0) {
      for (const w of d.walls) {
        const floorId = floorIds[w.floorIndex];
        if (!floorId) continue;
        await tx.wifiWall.create({ data: { projectId: id, floorId, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, material: w.material } });
      }
    }
    if (d.accessPoints && d.accessPoints.length > 0) {
      for (const a of d.accessPoints) {
        const floorId = floorIds[a.floorIndex];
        if (!floorId) continue;
        await tx.wifiAccessPoint.create({
          data: {
            projectId: id,
            floorId,
            name: a.name,
            ssid: a.ssid ?? null,
            heightM: a.heightM,
            posX: a.posX,
            posY: a.posY,
            enabled: a.enabled,
            radios: {
              create: a.radios.map((r) => ({
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
        });
      }
    }
  });

  await logActivity({ teamId: guard.team.id, userId: guard.user.id, action: "wifi-plan-import", message: "Import plan WiFi" });
  return NextResponse.json({ ok: true });
}