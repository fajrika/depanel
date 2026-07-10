import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, hashPassword, verifyPassword } from "@/lib/auth";
import { logActivity } from "@/lib/power";

const schema = z
  .object({
    name: z.string().min(1, "Nama wajib diisi").optional(),
    email: z.string().email("Format email tidak valid").optional(),
    uiLayout: z.enum(["topbar", "sidebar"]).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, "Password baru minimal 8 karakter").optional(),
  })
  .refine((v) => !v.newPassword || v.currentPassword, {
    message: "Masukkan password saat ini untuk mengganti password",
  });

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const { name, email, uiLayout, currentPassword, newPassword } = parsed.data;

  const data: { name?: string; email?: string; passwordHash?: string; uiLayout?: string } = {};

  if (name && name !== user.name) data.name = name;
  if (uiLayout && uiLayout !== user.uiLayout) data.uiLayout = uiLayout;

  if (email && email !== user.email) {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return NextResponse.json({ ok: false, message: "Email sudah dipakai akun lain" }, { status: 409 });
    data.email = email;
  }

  if (newPassword) {
    if (!currentPassword || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return NextResponse.json({ ok: false, message: "Password saat ini salah" }, { status: 400 });
    }
    data.passwordHash = await hashPassword(newPassword);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, message: "Tidak ada perubahan" });
  }

  const updated = await prisma.user.update({ where: { id: user.id }, data });
  await logActivity({
    userId: user.id,
    action: "profile-update",
    message: `Ubah profil: ${Object.keys(data).map((k) => (k === "passwordHash" ? "password" : k)).join(", ")}`,
  });
  return NextResponse.json({
    ok: true,
    data: { name: updated.name, email: updated.email, uiLayout: updated.uiLayout },
  });
}
