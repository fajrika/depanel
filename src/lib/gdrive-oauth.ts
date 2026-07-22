import crypto from "node:crypto";
import { prisma } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";

interface GDriveOAuthDest {
  clientId?: string;
  clientSecretEnc?: string;
  accessTokenEnc?: string;
  refreshTokenEnc?: string;
  gdriveUserEmail?: string;
  gdriveConnected?: boolean;
}

/** Get a valid access token for a GDrive job, refreshing if needed. */
export async function getGDriveOAuthToken(jobId: string): Promise<string> {
  const job = await prisma.dbBackupJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job tidak ditemukan");

  const dest = JSON.parse(job.destConfig) as GDriveOAuthDest;
  const clientId = dest.clientId;
  const clientSecretEnc = dest.clientSecretEnc;
  const accessTokenEnc = dest.accessTokenEnc;
  const refreshTokenEnc = dest.refreshTokenEnc;

  if (!clientId || !clientSecretEnc || !refreshTokenEnc) {
    throw new Error("Google Drive belum terkoneksi — silakan login Google dari form edit job");
  }

  const accessToken = accessTokenEnc ? decryptSecret(accessTokenEnc) : "";
  const refreshToken = decryptSecret(refreshTokenEnc);
  const clientSecret = decryptSecret(clientSecretEnc);

  // Try using access token first (most calls will be short-lived)
  // We always refresh to be safe since we don't track expiry in the DB
  // But let's try the access token first for a simple check
  if (accessToken) {
    // Quick check: is the token still valid?
    try {
      const checkRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (checkRes.ok) return accessToken;
    } catch { /* token invalid, refresh below */ }
  }

  // Refresh the token
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const refreshData = await refreshRes.json() as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!refreshRes.ok || !refreshData.access_token) {
    const errMsg = refreshData.error_description || refreshData.error || `Token refresh failed: ${refreshRes.status}`;
    // If refresh token is revoked, mark as disconnected
    if (refreshData.error === "invalid_grant") {
      const updatedDest = { ...dest, gdriveConnected: false };
      await prisma.dbBackupJob.update({
        where: { id: jobId },
        data: { destConfig: JSON.stringify(updatedDest) },
      });
      throw new Error("Google Drive token expired/revoked — silakan login Google ulang dari form edit job");
    }
    throw new Error(errMsg);
  }

  // Store refreshed access token
  const updatedDest = { ...dest, accessTokenEnc: encryptSecret(refreshData.access_token) };
  await prisma.dbBackupJob.update({
    where: { id: jobId },
    data: { destConfig: JSON.stringify(updatedDest) },
  });

  return refreshData.access_token;
}

/** Upload a file to Google Drive using OAuth2 token. */
export async function gdriveOAuthUpload(
  accessToken: string,
  folderId: string,
  fileName: string,
  fileBytes: Buffer,
): Promise<string> {
  const boundary = "----Depanel" + crypto.randomUUID();
  const metadata = JSON.stringify({ name: fileName, parents: folderId ? [folderId] : [] });
  const preamble = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(preamble), fileBytes, Buffer.from(epilogue)]);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`GDrive upload error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

/** Download a file from Google Drive by file id. */
export async function gdriveOAuthDownload(
  accessToken: string,
  fileId: string,
  destPath: string,
): Promise<void> {
  const fsp = await import("node:fs/promises");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`GDrive download error: ${res.status} ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(destPath, buf);
}
