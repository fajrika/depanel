import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const server = await prisma.server.findUnique({
    where: { id },
    select: { id: true, account: { select: { teamId: true } } },
  });
  if (!server) return NextResponse.json({ ok: false, message: "Server tidak ditemukan" }, { status: 404 });
  if (!server.account.teamId) return NextResponse.json({ ok: false, message: "Server tidak memiliki tim" }, { status: 400 });
  if (!(await canUseFeature(user.id, server.account.teamId, "accounts"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin mengelola akun" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const { isActive } = body ?? {};
  if (typeof isActive !== "boolean") {
    return NextResponse.json({ ok: false, message: "isActive harus boolean" }, { status: 400 });
  }

  await prisma.server.update({ where: { id }, data: { isActive } });
  return NextResponse.json({ ok: true, data: { id, isActive } });
}
