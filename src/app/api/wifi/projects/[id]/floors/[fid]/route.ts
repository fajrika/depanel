import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi, ownWifiProject } from "@/lib/wifi";

const floorSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  heightM: z.coerce.number().min(1).max(10).optional(),
  material: z.enum(["CONCRETE", "WOOD", "GYPSUM"]).optional(),
  floorplanData: z.string().max(8_000_000).optional().nullable(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string; fid: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id, fid } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });
  const parsed = floorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const floor = await prisma.wifiFloor.findFirst({ where: { id: fid, projectId: id } });
  if (!floor) return NextResponse.json({ ok: false, message: "Lantai tidak ditemukan" }, { status: 404 });
  const updated = await prisma.wifiFloor.update({ where: { id: fid }, data: parsed.data });
  return NextResponse.json({ ok: true, data: updated });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string; fid: string }> }) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const { id, fid } = await ctx.params;
  const owned = await ownWifiProject(guard.team.id, id);
  if (!owned.ok) return NextResponse.json({ ok: false, message: owned.message }, { status: owned.status });
  const floor = await prisma.wifiFloor.findFirst({ where: { id: fid, projectId: id } });
  if (!floor) return NextResponse.json({ ok: false, message: "Lantai tidak ditemukan" }, { status: 404 });
  const count = await prisma.wifiFloor.count({ where: { projectId: id } });
  if (count <= 1) return NextResponse.json({ ok: false, message: "Lantai terakhir tidak bisa dihapus" }, { status: 400 });
  await prisma.wifiFloor.delete({ where: { id: fid } });
  return NextResponse.json({ ok: true });
}