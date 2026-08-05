import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { decryptSecret } from "@/lib/crypto";

/** Step 1: Redirect user to Google OAuth consent screen for a GDrive destination. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const destId = url.searchParams.get("destId");
  if (!destId) return NextResponse.json({ ok: false, message: "destId wajib" }, { status: 400 });

  const dest = await prisma.dbDest.findUnique({ where: { id: destId } });
  if (!dest || !dest.teamId || !(await staffOf(user.id, dest.teamId))) {
    return NextResponse.json({ ok: false, message: "Koneksi tujuan tidak ditemukan / bukan wewenang Anda" }, { status: 403 });
  }
  if (dest.type !== "gdrive") {
    return NextResponse.json({ ok: false, message: "Koneksi tujuan ini bukan Google Drive" }, { status: 400 });
  }

  const cfg = JSON.parse(dest.config) as Record<string, unknown>;
  const clientId = String(cfg.clientId || "");
  const clientSecret = cfg.clientSecretEnc ? decryptSecret(String(cfg.clientSecretEnc)) : String(cfg.clientSecret || "");
  if (!clientId || !clientSecret) {
    return NextResponse.json({ ok: false, message: "clientId & clientSecret wajib diisi di koneksi tujuan dulu" }, { status: 400 });
  }

  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || url.host;
  const callbackUrl = `${proto}://${host}/api/db/gdrive/callback`;
  const state = Buffer.from(JSON.stringify({ destId, callbackUrl })).toString("base64url");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/drive");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent"); // force to always get refresh_token
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
