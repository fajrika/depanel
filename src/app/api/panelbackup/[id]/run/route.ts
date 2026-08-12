import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { runPanelBackup } from "@/lib/panelbackup";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const b = await prisma.panelBackup.findUnique({ where: { id } });
  if (!b?.teamId) return NextResponse.json({ ok: false, message: "Pengaturan tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, b.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  const active = await prisma.panelBackupRun.findFirst({ where: { panelBackupId: id, status: "running" } });
  if (active && Date.now() - new Date(active.startedAt).getTime() < STALE_LIMIT) {
    return NextResponse.json({ ok: false, message: "Backup sedang berjalan" }, { status: 409 });
  }

  const res = await runPanelBackup(id, "manual");
  return NextResponse.json({ ok: res.ok, data: res, message: res.message });
}

const STALE_LIMIT = 2 * 60 * 60 * 1000;
