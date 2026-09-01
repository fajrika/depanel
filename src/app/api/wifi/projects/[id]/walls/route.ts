import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi, ownWifiProject } from "@/lib/wifi";

const wallSchema = z.object({
  floorId: z.string().min(1),
  x1: z.coerce.number(),
  y1: z.coerce.number(),
  x2: z.coerce.number(),
  y2: z.coerce.number(),
  material: z.enum(["DRYWALL", "WOOD", "GLASS", "BRICK", "CONCRETE"]).default("DRYWALL"),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });
  const parsed = wallSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;
  const floor = await prisma.wifiFloor.findFirst({ where: { id: d.floorId, projectId: id } });
  if (!floor) return NextResponse.json({ ok: false, message: "Lantai tidak ditemukan" }, { status: 400 });
  const wall = await prisma.wifiWall.create({
    data: { projectId: id, floorId: d.floorId, x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, material: d.material },
  });
  return NextResponse.json({ ok: true, data: wall });
}