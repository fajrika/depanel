import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { logActivity } from "@/lib/power";

const patchSchema = z.object({
  role: z.enum(["admin", "member"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, message: "Hanya admin" }, { status: 403 });

  const { id } = await ctx.params;
  if (id === user.id) {
    return NextResponse.json({ ok: false, message: "Tidak bisa mengubah akun sendiri lewat sini" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });

  const { password, ...rest } = parsed.data;
  const target = await prisma.user.update({
    where: { id },
    data: { ...rest, ...(password ? { passwordHash: await hashPassword(password) } : {}) },
  });
  await logActivity({ userId: user.id, action: "user-update", message: `Ubah ${target.email}` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, message: "Hanya admin" }, { status: 403 });

  const { id } = await ctx.params;
  if (id === user.id) {
    return NextResponse.json({ ok: false, message: "Tidak bisa menghapus akun sendiri" }, { status: 400 });
  }
  const target = await prisma.user.delete({ where: { id } }).catch(() => null);
  if (target) await logActivity({ userId: user.id, action: "user-delete", message: `Hapus ${target.email}` });
  return NextResponse.json({ ok: true });
}
