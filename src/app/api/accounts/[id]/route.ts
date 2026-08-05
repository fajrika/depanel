import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const account = await prisma.depaAccount.findUnique({ where: { id } });
  if (!account?.teamId) return NextResponse.json({ ok: false, message: "Akun tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, account.teamId, "accounts"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin mengelola Akun API" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ ok: false, message: "Nama akun wajib diisi" }, { status: 400 });

  await prisma.depaAccount.update({ where: { id }, data: { name } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const account = await prisma.depaAccount.findUnique({ where: { id } });
  if (!account?.teamId) return NextResponse.json({ ok: false, message: "Akun tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, account.teamId, "accounts"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin mengelola Akun API" }, { status: 403 });
  }

  await prisma.depaAccount.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
