import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { membershipOf, staffOf } from "@/lib/team";
import { logActivity } from "@/lib/power";

async function requireOwner(userId: string, teamId: string) {
  const m = await membershipOf(userId, teamId);
  return m?.role === "owner" ? m : null;
}

const patchSchema = z.object({ name: z.string().min(1).optional() });

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await staffOf(user.id, id))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });

  await prisma.team.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await requireOwner(user.id, id))) {
    return NextResponse.json({ ok: false, message: "Hanya owner tim" }, { status: 403 });
  }
  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) return NextResponse.json({ ok: false, message: "Tim tidak ditemukan" }, { status: 404 });
  if (team.isPersonal) {
    return NextResponse.json({ ok: false, message: "Tim pribadi tidak bisa dihapus" }, { status: 400 });
  }

  await prisma.team.delete({ where: { id } });
  await logActivity({ userId: user.id, action: "team-delete", message: `Hapus tim ${team.name}` });
  return NextResponse.json({ ok: true });
}
