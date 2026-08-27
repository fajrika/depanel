import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi, ownWifiProject } from "@/lib/wifi";
import { logActivity } from "@/lib/power";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().max(500).optional().nullable(),
  widthM: z.coerce.number().min(1).max(200).optional(),
  heightM: z.coerce.number().min(1).max(200).optional(),
  scalePxPerM: z.coerce.number().min(5).max(100).optional(),
  bgColor: z.string().optional(),
  floorplanData: z.string().max(8_000_000).optional().nullable(),
  pathLossExponent: z.coerce.number().min(1.5).max(6).optional(),
  deadZoneDbm: z.coerce.number().min(-100).max(-50).optional(),
});

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { team } = await requireWifi();
  const { id } = await ctx.params;
  await ownWifiProject(team.id, id);
  const project = await prisma.wifiProject.findUnique({
    where: { id },
    include: {
      walls: { orderBy: { createdAt: "asc" } },
      accessPoints: { orderBy: { createdAt: "asc" } },
    },
  });
  return NextResponse.json({ ok: true, data: project });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, team } = await requireWifi();
  const { id } = await ctx.params;
  await ownWifiProject(team.id, id);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;
  const project = await prisma.wifiProject.update({ where: { id }, data: d });
  await logActivity({ teamId: team.id, userId: user.id, action: "wifi-project-update", message: `Ubah proyek WiFi "${project.name}"` });
  return NextResponse.json({ ok: true, data: project });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, team } = await requireWifi();
  const { id } = await ctx.params;
  const project = await ownWifiProject(team.id, id);
  await prisma.wifiProject.delete({ where: { id } });
  await logActivity({ teamId: team.id, userId: user.id, action: "wifi-project-delete", message: `Hapus proyek WiFi "${project.name}"` });
  return NextResponse.json({ ok: true });
}
