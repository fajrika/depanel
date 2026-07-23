import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { encryptSecret } from "@/lib/crypto";
import mysql from "mysql2/promise";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const conn = await prisma.dbConnection.findUnique({ where: { id } });
  if (!conn?.teamId) return NextResponse.json({ ok: false, message: "Koneksi tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, conn.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  const body = await req.json();
  const { name, host, port, username, password } = body ?? {};
  if (!name || !host || !username) {
    return NextResponse.json({ ok: false, message: "nama, host, username wajib diisi" }, { status: 400 });
  }

  const newPort = Number(port) || 3306;
  const newPassword = password || conn.passwordEnc;

  // If password is provided and changed, test the connection first
  if (password) {
    try {
      const c = await mysql.createConnection({ host, port: newPort, user: username, password, connectTimeout: 8000 });
      await c.query("SELECT 1");
      await c.end();
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
  if (!(await staffOf(user.id, conn.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  await prisma.dbConnection.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
