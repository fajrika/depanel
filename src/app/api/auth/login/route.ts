import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword, signSession, setSessionCookie } from "@/lib/auth";
import { verifyTotp } from "@/lib/totp";
import { logActivity } from "@/lib/power";

const schema = z.object({ email: z.string().email(), password: z.string().min(1), code: z.string().optional() });

const WINDOW_MS = 15 * 60 * 1000; // 15 menit
const MAX_FAIL_EMAIL = 6; // lockout per email
const MAX_FAIL_IP = 15; // lockout per IP
const CLEANUP_MS = 24 * 60 * 60 * 1000; // retensi LoginAttempt

function getClientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

async function recordAttempt(email: string, ip: string | null, ok: boolean) {
  try {
    await prisma.loginAttempt.create({ data: { email, ip, ok } });
  } catch {
    /* jangan sampai kegagalan pencatatan merusak alur login */
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Email/password tidak valid" }, { status: 400 });
  }
  const { email, password, code } = parsed.data;
  const ip = getClientIp(request);

  // bersihkan sesekali: hapus LoginAttempt yang lebih lama dari 24 jam
  try {
    await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - CLEANUP_MS) } } });
  } catch {
    /* abaikan */
  }

  const since = new Date(Date.now() - WINDOW_MS);
  const [failEmail, failIp] = await Promise.all([
    prisma.loginAttempt.count({ where: { email, ok: false, createdAt: { gte: since } } }),
    ip ? prisma.loginAttempt.count({ where: { ip, ok: false, createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);

  if (failEmail >= MAX_FAIL_EMAIL) {
    await recordAttempt(email, ip, false);
    return NextResponse.json({ ok: false, message: "Terlalu banyak percobaan. Coba lagi nanti." }, { status: 429 });
  }
  if (failIp >= MAX_FAIL_IP) {
    await recordAttempt(email, ip, false);
    return NextResponse.json({ ok: false, message: "Terlalu banyak percobaan. Coba lagi nanti." }, { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    await recordAttempt(email, ip, false);
    return NextResponse.json({ ok: false, message: "Email atau password salah" }, { status: 401 });
  }
  // Second factor, if enabled
  if (user.totpEnabled && user.totpSecret) {
    if (!code) {
      return NextResponse.json({ ok: false, need2fa: true, message: "Masukkan kode 2FA" }, { status: 401 });
    }
    if (!verifyTotp(user.totpSecret, code)) {
      await recordAttempt(email, ip, false);
      return NextResponse.json({ ok: false, need2fa: true, message: "Kode 2FA salah" }, { status: 401 });
    }
  }

  // sukses — catat attempt ok=true hanya setelah 2FA lolos
  await recordAttempt(email, ip, true);

  // deteksi login dari lokasi/IP baru
  if (ip && ip !== user.lastLoginIp) {
    if (user.lastLoginIp) {
      try {
        await prisma.inAppNotification.create({
          data: {
            userId: user.id,
            type: "security",
            title: "Login dari lokasi baru",
            message: `Login baru terdeteksi dari IP ${ip}`,
          },
        });
      } catch {
        /* jangan crash bila notifikasi gagal */
      }
    }
    try {
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginIp: ip } });
    } catch {
      /* abaikan */
    }
  }

  const token = await signSession({ sub: user.id, email: user.email, name: user.name, role: user.role });
  await setSessionCookie(token);
  await logActivity({ userId: user.id, action: "login", source: "web", message: `${user.email} login` });
  return NextResponse.json({ ok: true, user: { name: user.name, email: user.email, role: user.role } });
}
