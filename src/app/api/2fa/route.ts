import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, verifyPassword } from "@/lib/auth";
import { randomBase32Secret, otpauthUrl, verifyTotp } from "@/lib/totp";
import { logActivity } from "@/lib/power";

/** Status of 2FA for the current user. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, enabled: user.totpEnabled });
}

const schema = z.object({
  action: z.enum(["setup", "enable", "disable"]),
  code: z.string().optional(),
  password: z.string().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  const { action, code, password } = parsed.data;

  if (action === "setup") {
    // generate a fresh (not-yet-enabled) secret and return the otpauth URL
    const secret = randomBase32Secret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret, totpEnabled: false } });
    return NextResponse.json({ ok: true, data: { secret, otpauth: otpauthUrl(secret, user.email) } });
  }

  if (action === "enable") {
    if (!user.totpSecret) return NextResponse.json({ ok: false, message: "Jalankan setup dulu" }, { status: 400 });
    if (!code || !verifyTotp(user.totpSecret, code)) {
      return NextResponse.json({ ok: false, message: "Kode salah — coba lagi" }, { status: 400 });
    }
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
    await logActivity({ userId: user.id, action: "2fa-enable", message: "Aktifkan 2FA" });
    return NextResponse.json({ ok: true });
  }

  // disable — require current password OR a valid code
  const passOk = password && (await verifyPassword(password, user.passwordHash));
  const codeOk = code && user.totpSecret && verifyTotp(user.totpSecret, code);
  if (!passOk && !codeOk) {
    return NextResponse.json({ ok: false, message: "Butuh password atau kode 2FA yang benar" }, { status: 400 });
  }
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: null } });
  await logActivity({ userId: user.id, action: "2fa-disable", message: "Nonaktifkan 2FA" });
  return NextResponse.json({ ok: true });
}
