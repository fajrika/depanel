import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam, canUseFeature } from "@/lib/team";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (!(await canUseFeature(user.id, team.id, "infra"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin" }, { status: 403 });
  }

  const groups = await prisma.healthGroup.findMany({
    where: { teamId: team.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { checks: true } } },
  });
  return NextResponse.json({
    ok: true,
    data: groups.map((g) => ({ id: g.id, name: g.name, checkCount: g._count.checks })),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (!(await canUseFeature(user.id, team.id, "infra"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin" }, { status: 403 });
  }

  const parsed = z.object({ name: z.string().min(1).max(60) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Nama grup wajib diisi" }, { status: 400 });
  }

  const existing = await prisma.healthGroup.findUnique({
    where: { teamId_name: { teamId: team.id, name: parsed.data.name.trim() } },
  });
  if (existing) return NextResponse.json({ ok: false, message: "Nama grup sudah ada" }, { status: 409 });

  const g = await prisma.healthGroup.create({ data: { teamId: team.id, name: parsed.data.name.trim() } });
  return NextResponse.json({ ok: true, data: { id: g.id, name: g.name } });
}
