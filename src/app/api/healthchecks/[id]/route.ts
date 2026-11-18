import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
import { logActivity } from "@/lib/power";
import { isValidTimezone, parseHHMM } from "@/lib/healthcheck-window";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  url: z.string().url("URL tidak valid").optional(),
  groupId: z.string().nullable().optional(),
  method: z.enum(["GET", "HEAD", "POST"]).optional(),
  expectedStatus: z.coerce.number().int().min(100).max(599).optional(),
  intervalMin: z.coerce.number().int().min(1).max(1440).optional(),
  timeoutSec: z.coerce.number().int().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  scheduleMode: z.enum(["always", "only", "skip"]).optional(),
  windowStart: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Format jam harus HH:MM").nullable().optional(),
  windowEnd: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Format jam harus HH:MM").nullable().optional(),
  timezone: z.string().refine(isValidTimezone, "Zona waktu tidak valid").optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const hc = await prisma.healthCheck.findUnique({ where: { id } });
  if (!hc?.teamId) return NextResponse.json({ ok: false, message: "Health check tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, hc.teamId, "infra"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin mengubah health check" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;
  if (d.groupId !== undefined) {
    if (d.groupId) {
      const g = await prisma.healthGroup.findUnique({ where: { id: d.groupId }, select: { teamId: true } });
      if (!g?.teamId || g.teamId !== hc.teamId) {
        return NextResponse.json({ ok: false, message: "Grup tidak ditemukan" }, { status: 400 });
      }
    } else {
      d.groupId = null;
    }
  }

  // validasi jendela waktu terhadap nilai gabungan (lama + perubahan)
  const mode = d.scheduleMode ?? hc.scheduleMode;
  if (mode === "always") {
    if (d.scheduleMode !== undefined) {
      d.windowStart = null;
      d.windowEnd = null;
    }
  } else {
    const ws = d.windowStart !== undefined ? d.windowStart : hc.windowStart;
    const we = d.windowEnd !== undefined ? d.windowEnd : hc.windowEnd;
    if (parseHHMM(ws) === null || parseHHMM(we) === null || parseHHMM(ws) === parseHHMM(we)) {
      return NextResponse.json({ ok: false, message: "Jam mulai & selesai jadwal wajib diisi dan tidak boleh sama" }, { status: 400 });
    }
  }

  await prisma.healthCheck.update({ where: { id }, data: d });
  await logActivity({ teamId: hc.teamId, userId: user.id, action: "healthcheck-update", message: `Ubah health check "${hc.name}"` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const hc = await prisma.healthCheck.findUnique({ where: { id } });
  if (!hc?.teamId) return NextResponse.json({ ok: false, message: "Health check tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, hc.teamId, "infra"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin menghapus health check" }, { status: 403 });
  }

  await prisma.healthCheck.delete({ where: { id } });
  await logActivity({ teamId: hc.teamId, userId: user.id, action: "healthcheck-delete", message: `Hapus health check "${hc.name}"` });
  return NextResponse.json({ ok: true });
}
