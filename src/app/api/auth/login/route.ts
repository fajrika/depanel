import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword, signSession, setSessionCookie } from "@/lib/auth";
import { verifyTotp } from "@/lib/totp";
import { logActivity } from "@/lib/power";

const schema = z.object({ email: z.string().email(), password: z.string().min(1), code: z.string().optional() });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Email/password tidak valid" }, { status: 400 });
  }
  const { email, password, code } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ ok: false, message: "Email atau password salah" }, { status: 401 });
  }
  // Second factor, if enabled
  if (user.totpEnabled && user.totpSecret) {
    if (!code) {
      return NextResponse.json({ ok: false, need2fa: true, message: "Masukkan kode 2FA" }, { status: 401 });
    }
    if (!verifyTotp(user.totpSecret, code)) {
      return NextResponse.json({ ok: false, need2fa: true, message: "Kode 2FA salah" }, { status: 401 });
    }
  }
  const token = await signSession({ sub: user.id, email: user.email, name: user.name, role: user.role });
  await setSessionCookie(token);
  await logActivity({ userId: user.id, action: "login", source: "web", message: `${user.email} login` });
  return NextResponse.json({ ok: true, user: { name: user.name, email: user.email, role: user.role } });
}
