import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { testSshConnection } from "@/lib/dbbackup";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const ssh = await prisma.sshConnection.findUnique({ where: { id } });
  if (!ssh?.teamId) return NextResponse.json({ ok: false, message: "Koneksi SSH tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, ssh.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  const body = await req.json();
  const { name, host, port, username, authType, password, privateKey, keyPassphrase } = body ?? {};
  if (!name || !host || !username) {
    return NextResponse.json({ ok: false, message: "nama, host, username wajib diisi" }, { status: 400 });
  }

  const newPort = Number(port) || 22;
  const newAuth: "password" | "key" = authType === "key" ? "key" : authType === "password" ? "password" : ssh.authType === "key" ? "key" : "password";
  const newPassword = password ? String(password) : "";
  const newPrivateKey = privateKey ? String(privateKey).trim() : "";
  const newPassphrase = keyPassphrase ? String(keyPassphrase) : "";

  const credsChanged =
    authType !== undefined || host !== ssh.host || newPort !== ssh.port || username !== ssh.username || !!password || !!privateKey || !!keyPassphrase;

  const testCfg = {
    host,
    port: newPort,
    username,
    authType: newAuth as "password" | "key",
    password: newAuth === "password" ? newPassword || decryptSecret(ssh.passwordEnc) : "",
    privateKey: newAuth === "key" ? newPrivateKey || (ssh.privateKeyEnc ? decryptSecret(ssh.privateKeyEnc) : "") : undefined,
    keyPassphrase: newAuth === "key" ? newPassphrase || (ssh.keyPassphraseEnc ? decryptSecret(ssh.keyPassphraseEnc) : undefined) : undefined,
  };

  if (newAuth === "key" && !testCfg.privateKey) {
    return NextResponse.json({ ok: false, message: "Private key wajib diisi untuk auth public key" }, { status: 400 });
  }
  if (newAuth === "password" && !testCfg.password) {
    return NextResponse.json({ ok: false, message: "Password wajib diisi untuk auth password" }, { status: 400 });
  }

  // Re-test hanya jika ada perubahan yang memengaruhi koneksi; ganti nama saja tidak perlu tes.
  if (credsChanged) {
    try {
      await testSshConnection(testCfg);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, message: `Koneksi SSH gagal: ${msg}` }, { status: 400 });
    }
  }

  const updated = await prisma.sshConnection.update({
    where: { id },
    data: {
      name,
      host,
      port: newPort,
      username,
      authType: newAuth,
      passwordEnc: newAuth === "password" ? encryptSecret(testCfg.password) : "",
      privateKeyEnc: newAuth === "key" && testCfg.privateKey ? encryptSecret(testCfg.privateKey) : null,
      keyPassphraseEnc: newPassphrase ? encryptSecret(newPassphrase) : ssh.keyPassphraseEnc,
    },
  });

  return NextResponse.json({ ok: true, data: { id: updated.id, name: updated.name, host: updated.host, port: updated.port, username: updated.username, authType: updated.authType } });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const ssh = await prisma.sshConnection.findUnique({ where: { id }, include: { _count: { select: { dbConns: true } } } });
  if (!ssh?.teamId) return NextResponse.json({ ok: false, message: "Koneksi SSH tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, ssh.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  if (ssh._count.dbConns > 0) {
    return NextResponse.json({ ok: false, message: `Tidak bisa dihapus — masih dipakai oleh ${ssh._count.dbConns} koneksi database.` }, { status: 400 });
  }

  await prisma.sshConnection.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
