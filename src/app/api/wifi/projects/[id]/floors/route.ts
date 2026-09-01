import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi, ownWifiProject } from "@/lib/wifi";

const MAX_FLOORS = 5;

const floorSchema = z.object({
  name: z.string().min(1, "Nama lantai wajib diisi").max(60).default("Lantai baru"),
  level: z.coerce.number().int().min(1).max(99).optional(),
  heightM: z.coerce.number().min(1).max(10).default(3),
  material: z.enum(["CONCRETE", "WOOD", "GYPSUM"]).default("CONCRETE"),
  floorplanData: z.string().max(8_000_000).optional().nullable(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });
  const parsed = floorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;

  const count = await prisma.wifiFloor.count({ where: { projectId: id } });
  if (count >= MAX_FLOORS) {
    return NextResponse.json({ ok: false, message: `Maksimal ${MAX_FLOORS} lantai per proyek` }, { status: 400 });
  }

  const level = d.level ?? count + 1;
  const dup = await prisma.wifiFloor.findFirst({ where: { projectId: id, level } });
  if (dup) return NextResponse.json({ ok: false, message: `Lantai level ${level} sudah ada` }, { status: 400 });

  const floor = await prisma.wifiFloor.create({
    data: { projectId: id, name: d.name, level, heightM: d.heightM, material: d.material, floorplanData: d.floorplanData ?? null },
  });
  return NextResponse.json({ ok: true, data: floor });
}