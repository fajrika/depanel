import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, getSession, isSuperAdmin, signSession, setSessionCookie } from "@/lib/auth";
import { logActivity } from "@/lib/power";

const schema = z.object({ userId: z.string().min(1) });

/** Super admin menyamar sebagai user lain. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  if (!(await isSuperAdmin(user.id))) {
    return NextResponse.json({ ok: false, message: "Hanya super admin" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  if (parsed.data.userId === user.id) {
    return NextResponse.json({ ok: false, message: "Tidak bisa menyamar sebagai diri sendiri" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!target || !target.active) {
    return NextResponse.json({ ok: false, message: "User tidak ditemukan / nonaktif" }, { status: 404 });
  }

  const token = await signSession({
    sub: target.id,
    email: target.email,
    name: target.name,
    role: target.role,
    imp: user.id, // jejak: siapa yang menyamar
  });
  await setSessionCookie(token);
  await logActivity({ userId: user.id, action: "impersonate", message: `Menyamar sebagai ${target.email}` });
  return NextResponse.json({ ok: true, data: { name: target.name } });
}

/** Kembali ke akun super admin. */
export async function DELETE() {
  const session = await getSession();
  if (!session?.imp) {
    return NextResponse.json({ ok: false, message: "Tidak sedang menyamar" }, { status: 400 });
  }
  if (!(await isSuperAdmin(session.imp))) {
    return NextResponse.json({ ok: false, message: "Sesi tidak valid" }, { status: 403 });
  }

  const original = await prisma.user.findUnique({ where: { id: session.imp } });
  if (!original) return NextResponse.json({ ok: false, message: "Akun asal tidak ditemukan" }, { status: 404 });

  const token = await signSession({
    sub: original.id,
    email: original.email,
    name: original.name,
    role: original.role,
  });
  await setSessionCookie(token);
  await logActivity({ userId: original.id, action: "impersonate-stop", message: `Kembali dari penyamaran (${session.email})` });
  return NextResponse.json({ ok: true });
}
