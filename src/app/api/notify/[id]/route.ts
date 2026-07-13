import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";

async function guard(userId: string, id: string) {
  const ch = await prisma.notifyChannel.findUnique({ where: { id } });
  if (!ch) return null;
  if (!(await staffOf(userId, ch.teamId))) return null;
  return ch;
}

/** Merge new config over the existing one, dropping empty strings so blanks keep old values. */
function mergeConfig(existing: string, incoming: Record<string, string>): string {
  let base: Record<string, string> = {};
  try {
    base = JSON.parse(existing);
  } catch {
    /* config lama rusak — mulai bersih */
  }
  for (const [k, v] of Object.entries(incoming)) {
    if (v !== "") base[k] = v; // biarkan field kosong = pertahankan nilai lama (mis. token)
  }
  return JSON.stringify(base);
}

const patchSchema = z.object({
  label: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  onPower: z.boolean().optional(),
  onBackup: z.boolean().optional(),
  onError: z.boolean().optional(),
  onBalance: z.boolean().optional(),
  config: z.record(z.string(), z.string()).optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const ch = await guard(user.id, id);
  if (!ch) return NextResponse.json({ ok: false, message: "Tidak diizinkan" }, { status: 403 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  const { config, ...rest } = parsed.data;
  await prisma.notifyChannel.update({
    where: { id },
    data: { ...rest, ...(config ? { config: mergeConfig(ch.config, config) } : {}) },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await guard(user.id, id))) return NextResponse.json({ ok: false, message: "Tidak diizinkan" }, { status: 403 });
  await prisma.notifyChannel.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
