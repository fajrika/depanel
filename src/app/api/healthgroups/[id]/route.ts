import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const g = await prisma.healthGroup.findUnique({ where: { id } });
  if (!g?.teamId) return NextResponse.json({ ok: false, message: "Grup tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, g.teamId, "infra"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin" }, { status: 403 });
  }

  await prisma.healthGroup.delete({ where: { id } }); // checks → groupId null (SetNull)
  return NextResponse.json({ ok: true });
}
