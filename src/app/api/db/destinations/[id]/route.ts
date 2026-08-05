import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { encryptSecret } from "@/lib/crypto";

async function guardDest(userId: string, destId: string) {
  const dest = await prisma.dbDest.findUnique({ where: { id: destId } });
  if (!dest?.teamId) return null;
  if (!(await staffOf(userId, dest.teamId))) return null;
  return dest;
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const dest = await guardDest(user.id, id);
  if (!dest) return NextResponse.json({ ok: false, message: "Koneksi tujuan tidak ditemukan / bukan wewenang Anda" }, { status: 403 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  const v = parsed.data;

  const data: Record<string, unknown> = {};
  if (v.name !== undefined) data.name = v.name;

  if (v.config !== undefined) {
    const existing = JSON.parse(dest.config) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...existing, ...v.config };
    // secret fields: jika diisi (non-empty) → enkripsi & timpa; jika kosong/tidak dikirim → pertahankan lama
    if (typeof merged.password === "string") {
      if (merged.password) {
        merged.passwordEnc = encryptSecret(merged.password);
      }
      delete merged.password;
    }
    if (typeof merged.secretKey === "string") {
      if (merged.secretKey) {
        merged.secretKeyEnc = encryptSecret(merged.secretKey);
      }
      delete merged.secretKey;
    }
    if (typeof merged.clientSecret === "string") {
      if (merged.clientSecret) {
        merged.clientSecretEnc = encryptSecret(merged.clientSecret);
        // kredensial OAuth berubah → token lama tidak valid, minta login ulang
        delete merged.accessTokenEnc;
        delete merged.refreshTokenEnc;
        merged.gdriveConnected = false;
        delete merged.gdriveUserEmail;
      }
      delete merged.clientSecret;
    }
    delete merged.accessTokenEnc;
    delete merged.refreshTokenEnc;
    delete merged.gdriveConnected;
    delete merged.gdriveUserEmail;
    data.config = JSON.stringify(merged);
  }

  await prisma.dbDest.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const dest = await guardDest(user.id, id);
  if (!dest) return NextResponse.json({ ok: false, message: "Koneksi tujuan tidak ditemukan / bukan wewenang Anda" }, { status: 403 });

  await prisma.dbDest.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
