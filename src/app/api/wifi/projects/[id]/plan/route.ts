import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi, ownWifiProject } from "@/lib/wifi";
import { logActivity } from "@/lib/power";

const planSchema = z.object({
  widthM: z.coerce.number().min(1).max(200).optional(),
  heightM: z.coerce.number().min(1).max(200).optional(),
  scalePxPerM: z.coerce.number().min(5).max(100).optional(),
  pathLossExponent: z.coerce.number().min(1.5).max(6).optional(),
  deadZoneDbm: z.coerce.number().min(-100).max(-50).optional(),
  walls: z
    .array(
      z.object({
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
        name: z.string().min(1).default("Access Point"),
        ssid: z.string().max(32).optional().nullable(),
        band: z.enum(["BAND_2_4", "BAND_5", "BAND_6"]),
        channel: z.coerce.number().int().min(1).max(233),
        channelWidth: z.coerce.number().int().refine((v) => [20, 40, 80, 160].includes(v)),
        txPowerDbm: z.coerce.number().min(0).max(30),
        antennaGainDbi: z.coerce.number().min(0).max(20),
        antennaType: z.enum(["OMNIDIRECTIONAL", "PATCH", "PANEL"]),
        azimuthDeg: z.coerce.number().int().min(0).max(360).optional().nullable(),
        heightM: z.coerce.number().min(0.5).max(10),
        posX: z.coerce.number(),
        posY: z.coerce.number(),
        enabled: z.boolean().default(true),
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
    await tx.wifiProject.update({ where: { id }, data: projectData });
    if (d.walls && d.walls.length > 0) {
      await tx.wifiWall.createMany({
        data: d.walls.map((w) => ({ ...w, projectId: id })),
      });
    }
    if (d.accessPoints && d.accessPoints.length > 0) {
      await tx.wifiAccessPoint.createMany({
        data: d.accessPoints.map((a) => ({
          projectId: id,
          name: a.name,
          ssid: a.ssid ?? null,
          band: a.band,
          channel: a.channel,
          channelWidth: a.channelWidth,
          txPowerDbm: a.txPowerDbm,
          antennaGainDbi: a.antennaGainDbi,
          antennaType: a.antennaType,
          azimuthDeg: a.azimuthDeg ?? null,
          heightM: a.heightM,
          posX: a.posX,
          posY: a.posY,
          enabled: a.enabled,
        })),
      });
    }
  });

  await logActivity({ teamId: guard.team.id, userId: guard.user.id, action: "wifi-plan-import", message: "Import plan WiFi" });
  return NextResponse.json({ ok: true });
}
