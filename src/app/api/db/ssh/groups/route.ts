import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member" && !team.canSsh) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin" }, { status: 403 });
  }

  const groups = await prisma.sshGroup.findMany({
    where: { teamId: team.id },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      sortOrder: true,
      _count: { select: { connections: true } },
    },
  });
  return NextResponse.json({ ok: true, data: groups.map((g) => ({ ...g, connCount: g._count.connections })) });
}

const schema = z.object({ name: z.string().min(1).max(100) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member" && !team.canSsh) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }

  const existing = await prisma.sshGroup.findFirst({ where: { teamId: team.id, name: parsed.data.name } });
  if (existing) {
    return NextResponse.json({ ok: false, message: "Nama grup sudah ada" }, { status: 400 });
  }

  const maxSort = await prisma.sshGroup.findMany({ where: { teamId: team.id }, orderBy: { sortOrder: "desc" }, take: 1, select: { sortOrder: true } });
  const group = await prisma.sshGroup.create({
    data: { name: parsed.data.name, teamId: team.id, sortOrder: (maxSort[0]?.sortOrder ?? -1) + 1 },
  });
  return NextResponse.json({ ok: true, data: { id: group.id, name: group.name } });
}

const patchSchema = z.object({ id: z.string().min(1), name: z.string().min(1).max(100).optional(), sortOrder: z.number().int().optional() });

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member" && !team.canSsh) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }

  const group = await prisma.sshGroup.findFirst({ where: { id: parsed.data.id, teamId: team.id } });
  if (!group) return NextResponse.json({ ok: false, message: "Grup tidak ditemukan" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder;

  await prisma.sshGroup.update({ where: { id: group.id }, data });
  return NextResponse.json({ ok: true });
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member" && !team.canSsh) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin" }, { status: 403 });
  }

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  }

  const group = await prisma.sshGroup.findFirst({ where: { id: parsed.data.id, teamId: team.id } });
  if (!group) return NextResponse.json({ ok: false, message: "Grup tidak ditemukan" }, { status: 404 });

  await prisma.sshGroup.delete({ where: { id: group.id } });
  return NextResponse.json({ ok: true });
}
