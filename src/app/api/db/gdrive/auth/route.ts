import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { decryptSecret } from "@/lib/crypto";

/** Step 1: Redirect user to Google OAuth consent screen. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ ok: false, message: "jobId wajib" }, { status: 400 });

  const job = await prisma.dbBackupJob.findUnique({
    where: { id: jobId },
    include: { connection: { select: { teamId: true } } },
  });
  if (!job || !job.connection.teamId || !(await staffOf(user.id, job.connection.teamId))) {
    return NextResponse.json({ ok: false, message: "Job tidak ditemukan / bukan wewenang Anda" }, { status: 403 });
  }
  if (job.destType !== "gdrive") {
    return NextResponse.json({ ok: false, message: "Job ini bukan Google Drive" }, { status: 400 });
  }

  const dest = JSON.parse(job.destConfig) as Record<string, unknown>;
  // try decrypted clientSecret
  const clientId = String(dest.clientId || "");
  const clientSecret = dest.clientSecretEnc ? decryptSecret(String(dest.clientSecretEnc)) : String(dest.clientSecret || "");
  if (!clientId || !clientSecret) {
    return NextResponse.json({ ok: false, message: "clientId & clientSecret wajib diisi di form job dulu" }, { status: 400 });
  }

  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || url.host;
  const callbackUrl = `${proto}://${host}/api/db/gdrive/callback`;
  const state = Buffer.from(JSON.stringify({ jobId, callbackUrl })).toString("base64url");

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
