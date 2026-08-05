import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/** Step 2: Handle Google OAuth callback, exchange code for tokens, store in destination. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || url.host;
  const origin = `${proto}://${host}`;

  if (error) {
    const msg = encodeURIComponent(`Google auth error: ${error}`);
    return NextResponse.redirect(`${origin}/dbbackup?tab=tujuan&gdrive_error=${msg}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${origin}/dbbackup?tab=tujuan&gdrive_error=${encodeURIComponent("Missing code/state")}`);
  }

  let parsed: { destId: string; callbackUrl: string };
  try {
    parsed = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    return NextResponse.redirect(`${origin}/dbbackup?tab=tujuan&gdrive_error=${encodeURIComponent("Invalid state")}`);
  }

  const { destId, callbackUrl } = parsed;

  const dest = await prisma.dbDest.findUnique({ where: { id: destId } });
  if (!dest) {
    return NextResponse.redirect(`${origin}/dbbackup?tab=tujuan&gdrive_error=${encodeURIComponent("Koneksi tujuan tidak ditemukan")}`);
  }

  const cfg = JSON.parse(dest.config) as Record<string, unknown>;
  const clientId = String(cfg.clientId || "");
  const clientSecret = cfg.clientSecretEnc ? decryptSecret(String(cfg.clientSecretEnc)) : String(cfg.clientSecret || "");

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/dbbackup?tab=tujuan&gdrive_error=${encodeURIComponent("clientId/clientSecret kosong di koneksi tujuan")}`);
  }

  // Exchange authorization code for tokens
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || !tokenData.access_token) {
      const errMsg = tokenData.error_description || tokenData.error || `Token exchange failed: ${tokenRes.status}`;
      return NextResponse.redirect(`${origin}/dbbackup?tab=tujuan&gdrive_error=${encodeURIComponent(errMsg)}`);
    }

    // Get user email for display
    let userEmail = "";
    try {
      const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const me = await meRes.json() as { email?: string };
      userEmail = me.email || "";
    } catch { /* ignore */ }

    // Store tokens encrypted in destination config
    const updatedCfg = { ...cfg };
    updatedCfg.accessTokenEnc = encryptSecret(tokenData.access_token);
    if (tokenData.refresh_token) {
      updatedCfg.refreshTokenEnc = encryptSecret(tokenData.refresh_token);
    }
    updatedCfg.gdriveUserEmail = userEmail;
    updatedCfg.gdriveConnected = true;

    await prisma.dbDest.update({
      where: { id: destId },
      data: { config: JSON.stringify(updatedCfg) },
    });

    return NextResponse.redirect(`${origin}/dbbackup?tab=tujuan&gdrive_ok=${encodeURIComponent(userEmail || "connected")}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(`${origin}/dbbackup?tab=tujuan&gdrive_error=${encodeURIComponent(msg)}`);
  }
}
