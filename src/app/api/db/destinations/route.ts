import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";
import { encryptSecret } from "@/lib/crypto";

/** Fields that are safe to send to the browser (never the encrypted secrets). */
function sanitizeConfig(dest: { type: string; config: string }) {
  const cfg = JSON.parse(dest.config) as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  if (dest.type === "ftp") {
    for (const k of ["host", "port", "secure"]) if (cfg[k] !== undefined) safe[k] = cfg[k];
  } else if (dest.type === "s3") {
    for (const k of ["bucket", "region", "endpoint"]) if (cfg[k] !== undefined) safe[k] = cfg[k];
    safe.accessKeyId = String(cfg.accessKeyId || "");
  } else if (dest.type === "gdrive") {
    safe.clientId = String(cfg.clientId || "");
    safe.gdriveConnected = cfg.gdriveConnected === true;
    safe.gdriveUserEmail = String(cfg.gdriveUserEmail || "");
  }
  return safe;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member") return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });

  const dests = await prisma.dbDest.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { jobs: true } } },
  });
  return NextResponse.json({
    ok: true,
    data: dests.map((d) => ({ id: d.id, type: d.type, name: d.name, createdAt: d.createdAt, jobCount: d._count.jobs, config: sanitizeConfig(d) })),
  });
}

const configSchema = z
  .object({
    ftp: z.object({
      host: z.string().min(1, "Host FTP wajib diisi"),
      port: z.number().int().min(1).max(65535).default(21),
      username: z.string().min(1, "Username FTP wajib diisi"),
      password: z.string().min(1, "Password FTP wajib diisi"),
      secure: z.boolean().default(false),
    }),
    s3: z.object({
      bucket: z.string().min(1, "Bucket S3 wajib diisi"),
      region: z.string().default("auto"),
      endpoint: z.string().optional(),
      accessKeyId: z.string().min(1, "Access key S3 wajib diisi"),
      secretKey: z.string().min(1, "Secret key S3 wajib diisi"),
    }),
    gdrive: z.object({
      clientId: z.string().min(1, "Google OAuth Client ID wajib diisi"),
      clientSecret: z.string().min(1, "Google OAuth Client Secret wajib diisi"),
    }),
  });

const createSchema = z.object({
  type: z.enum(["ftp", "s3", "gdrive"]),
  name: z.string().min(1),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member") return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  const { type, name, config } = parsed.data;

  const cfgCheck = configSchema.shape[type].safeParse(config);
  if (!cfgCheck.success) return NextResponse.json({ ok: false, message: cfgCheck.error.issues[0]?.message ?? "Konfigurasi tidak valid" }, { status: 400 });
  const v = cfgCheck.data;

  const stored: Record<string, unknown> = { ...v };
  if (typeof stored.password === "string" && stored.password) {
    stored.passwordEnc = encryptSecret(stored.password);
    delete stored.password;
  }
  if (typeof stored.secretKey === "string" && stored.secretKey) {
    stored.secretKeyEnc = encryptSecret(stored.secretKey);
    delete stored.secretKey;
  }
  if (typeof stored.clientSecret === "string" && stored.clientSecret) {
    stored.clientSecretEnc = encryptSecret(stored.clientSecret);
    delete stored.clientSecret;
  }
  // OAuth tokens datang dari callback, bukan form create
  delete stored.accessTokenEnc;
  delete stored.refreshTokenEnc;
  delete stored.gdriveConnected;
  delete stored.gdriveUserEmail;

  const dest = await prisma.dbDest.create({
    data: { type, name, config: JSON.stringify(stored), teamId: team.id },
  });
  return NextResponse.json({ ok: true, data: { id: dest.id } });
}
