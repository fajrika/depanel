import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { testConnection } from "@/lib/dbbackup";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const conn = await prisma.dbConnection.findUnique({ where: { id } });
  if (!conn?.teamId) return NextResponse.json({ ok: false, message: "Koneksi tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, conn.teamId, "backupDb"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak punya akses ke Backup DB" }, { status: 403 });
  }

  const body = await req.json();
  const { name, host, port, username, password } = body ?? {};
  if (!name || !host || !username) {
    return NextResponse.json({ ok: false, message: "nama, host, username wajib diisi" }, { status: 400 });
  }

  const newPort = Number(port) || 3306;
  const newPassword = password || conn.passwordEnc;
  const newSshId = body.sshId === undefined ? conn.sshId : body.sshId || null;

  // Validate SSH reference if changed
  const sshChanged = newSshId !== conn.sshId;
  let sshRow: { host: string; port: number; username: string; authType: string; passwordEnc: string; privateKeyEnc: string | null; keyPassphraseEnc: string | null; teamId: string | null } | null = null;
  if (newSshId) {
    sshRow = await prisma.sshConnection.findUnique({ where: { id: newSshId } });
    if (!sshRow || sshRow.teamId !== conn.teamId) {
      return NextResponse.json({ ok: false, message: "Koneksi SSH tidak ditemukan di tim ini" }, { status: 400 });
    }
  }

  // Test the connection when the password changed, the SSH tunnel changed, or SSH is enabled now
  if (password || sshChanged) {
    try {
      await testConnection({
        host,
        port: newPort,
        username,
        password,
        ssh: sshRow
          ? {
              host: sshRow.host,
              port: sshRow.port,
              username: sshRow.username,
              authType: sshRow.authType === "key" ? "key" : "password",
              password: decryptSecret(sshRow.passwordEnc),
              privateKey: sshRow.privateKeyEnc ? decryptSecret(sshRow.privateKeyEnc) : undefined,
              keyPassphrase: sshRow.keyPassphraseEnc ? decryptSecret(sshRow.keyPassphraseEnc) : undefined,
            }
          : undefined,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, message: `Koneksi gagal: ${msg}` }, { status: 400 });
    }
  }

  const updated = await prisma.dbConnection.update({
    where: { id },
    data: {
      name,
      host,
      port: newPort,
      username,
      sshId: newSshId,
      passwordEnc: password ? encryptSecret(password) : conn.passwordEnc,
    },
  });

  return NextResponse.json({ ok: true, data: { id: updated.id, name: updated.name, host: updated.host, port: updated.port, username: updated.username } });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const conn = await prisma.dbConnection.findUnique({ where: { id } });
  if (!conn?.teamId) return NextResponse.json({ ok: false, message: "Koneksi tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, conn.teamId, "backupDb"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak punya akses ke Backup DB" }, { status: 403 });
  }

  await prisma.dbConnection.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
