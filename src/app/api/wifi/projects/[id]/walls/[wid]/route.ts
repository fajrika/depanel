import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi, ownWifiProject } from "@/lib/wifi";

const wallSchema = z.object({
  x1: z.coerce.number().optional(),
  y1: z.coerce.number().optional(),
  x2: z.coerce.number().optional(),
  y2: z.coerce.number().optional(),
  material: z.enum(["DRYWALL", "WOOD", "GLASS", "BRICK", "CONCRETE"]).optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string; wid: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id, wid } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });
  const parsed = wallSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  }
  const wall = await prisma.wifiWall.findFirst({ where: { id: wid, projectId: id } });
  if (!wall) return NextResponse.json({ ok: false, message: "Dinding tidak ditemukan" }, { status: 404 });
  const updated = await prisma.wifiWall.update({ where: { id: wid }, data: parsed.data });
  return NextResponse.json({ ok: true, data: updated });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string; wid: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id, wid } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });
  const wall = await prisma.wifiWall.findFirst({ where: { id: wid, projectId: id } });
  if (!wall) return NextResponse.json({ ok: false, message: "Dinding tidak ditemukan" }, { status: 404 });
  await prisma.wifiWall.delete({ where: { id: wid } });
  return NextResponse.json({ ok: true });
}
