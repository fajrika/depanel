import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWifi } from "@/lib/wifi";
import { logActivity } from "@/lib/power";

const createSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi"),
  description: z.string().max(500).optional().nullable(),
  widthM: z.coerce.number().min(1).max(200).default(20),
  heightM: z.coerce.number().min(1).max(200).default(15),
  scalePxPerM: z.coerce.number().min(5).max(100).default(20),
  bgColor: z.string().default("#f8fafc"),
  pathLossExponent: z.coerce.number().min(1.5).max(6).default(3),
  deadZoneDbm: z.coerce.number().min(-100).max(-50).default(-70),
});

export async function GET() {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const projects = await prisma.wifiProject.findMany({
    where: { teamId: guard.team.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { accessPoints: true, walls: true } } },
  });
  return NextResponse.json({ ok: true, data: projects });
}

export async function POST(request: Request) {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;
  const project = await prisma.wifiProject.create({
    data: {
      teamId: guard.team.id,
      name: d.name,
      description: d.description ?? null,
      widthM: d.widthM,
      heightM: d.heightM,
      scalePxPerM: d.scalePxPerM,
      bgColor: d.bgColor,
      pathLossExponent: d.pathLossExponent,
      deadZoneDbm: d.deadZoneDbm,
    },
  });
  await logActivity({ teamId: guard.team.id, userId: guard.user.id, action: "wifi-project-create", message: `Buat proyek WiFi "${d.name}"` });
  return NextResponse.json({ ok: true, data: { id: project.id } });
}
