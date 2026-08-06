import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";
import { encryptSecret } from "@/lib/crypto";
import { testSshConnection } from "@/lib/dbbackup";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member" && !team.canSsh) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuka SSH Koneksi" }, { status: 403 });
  }

  const sshs = await prisma.sshConnection.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, host: true, port: true, username: true, authType: true, groupId: true, createdAt: true, _count: { select: { dbConns: true } }, group: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ ok: true, data: sshs.map((s) => ({ ...s, connCount: s._count.dbConns, groupName: s.group?.name ?? null })) });
}

const createSchema = z
  .object({
    name: z.string().min(1),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.string().min(1),
    authType: z.enum(["password", "key"]).default("password"),
    password: z.string().optional(),
    privateKey: z.string().optional(),
    keyPassphrase: z.string().optional(),
    groupId: z.string().nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.authType === "key" && !d.privateKey?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Private key wajib diisi untuk auth public key" });
    }
    if (d.authType === "password" && !d.password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Password wajib diisi untuk auth password" });
    }
  });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member" && !team.canSsh) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuka SSH Koneksi" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const { name, host, port, username, authType, password, privateKey, keyPassphrase, groupId } = parsed.data;

  try {
    await testSshConnection({
      host,
      port,
      username,
      authType,
      password: password ?? "",
      privateKey: privateKey || undefined,
      keyPassphrase: keyPassphrase || undefined,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `Koneksi SSH gagal: ${(e as Error).message}` }, { status: 400 });
  }

  const ssh = await prisma.sshConnection.create({
    data: {
      name,
      host,
      port,
      username,
      authType,
      passwordEnc: authType === "password" ? encryptSecret(password ?? "") : "",
      privateKeyEnc: authType === "key" && privateKey ? encryptSecret(privateKey) : null,
      keyPassphraseEnc: keyPassphrase ? encryptSecret(keyPassphrase) : null,
      teamId: team.id,
      groupId: groupId || null,
    },
  });
  return NextResponse.json({ ok: true, data: { id: ssh.id } });
}
