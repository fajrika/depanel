import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";

export async function GET(_req: Request, ctx: { params: Promise<{ restoreId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Belum terautentikasi" }, { status: 401 });

  const { restoreId } = await ctx.params;
  const restore = await prisma.dbRestoreRun.findUnique({ where: { id: restoreId } });
  if (!restore) return NextResponse.json({ ok: false, message: "Restore tidak ditemukan" }, { status: 404 });

  if (restore.teamId && !(await staffOf(user.id, restore.teamId))) {
    return NextResponse.json({ ok: false, message: "Tidak diizinkan" }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      id: restore.id,
      status: restore.status,
      message: restore.message,
      warnings: restore.warnings ? JSON.parse(restore.warnings) : null,
      startedAt: restore.startedAt,
      endedAt: restore.endedAt,
    },
  });
}
