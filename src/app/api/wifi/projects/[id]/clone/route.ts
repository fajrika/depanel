import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi, ownWifiProject } from "@/lib/wifi";
import { logActivity } from "@/lib/power";

const cloneSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi").max(200).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });

  const parsed = cloneSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }

  const source = await prisma.wifiProject.findUnique({
    where: { id },
    include: {
      walls: true,
      accessPoints: { include: { radios: true } },
    },
  });
  if (!source) return NextResponse.json({ ok: false, message: "Proyek tidak ditemukan" }, { status: 404 });

  const newName = parsed.data.name?.trim() || `${source.name} (copy)`;

  const clone = await prisma.$transaction(async (tx) => {
    const created = await tx.wifiProject.create({
      data: {
        teamId: source.teamId,
        name: newName,
        description: source.description,
        widthM: source.widthM,
        heightM: source.heightM,
        scalePxPerM: source.scalePxPerM,
        bgColor: source.bgColor,
        floorplanData: source.floorplanData,
        pathLossExponent: source.pathLossExponent,
        deadZoneDbm: source.deadZoneDbm,
        walls: {
          create: source.walls.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, material: w.material })),
        },
        accessPoints: {
          create: source.accessPoints.map((a) => ({
            name: a.name,
            ssid: a.ssid,
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
                azimuthDeg: r.azimuthDeg,
                enabled: r.enabled,
              })),
            },
          })),
        },
      },
    });
    return created;
  });

  await logActivity({ teamId: guard.team.id, userId: guard.user.id, action: "wifi-project-clone", message: `Salin proyek WiFi "${source.name}" → "${newName}"` });
  return NextResponse.json({ ok: true, data: { id: clone.id } });
}