import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { restoreRun } from "@/lib/dbbackup";
import { logActivity } from "@/lib/power";

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ ok: false, message: "Belum terautentikasi" }, { status: 401 });
    const { runId } = await ctx.params;
    const run = await prisma.dbBackupRun.findUnique({
      where: { id: runId },
      include: { job: { include: { connection: { select: { teamId: true } } } } },
    });
    if (!run?.job.connection.teamId) return NextResponse.json({ ok: false, message: "Run tidak ditemukan" }, { status: 404 });
    if (!(await staffOf(user.id, run.job.connection.teamId))) {
      return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
    }

    let targetConnId: string | undefined;
    try {
      const body = await req.json();
      targetConnId = body.targetConnectionId || undefined;
    } catch {}

    if (targetConnId) {
      const targetConn = await prisma.dbConnection.findUnique({ where: { id: targetConnId } });
      if (!targetConn || targetConn.teamId !== run.job.connection.teamId) {
        return NextResponse.json({ ok: false, message: "Koneksi tujuan tidak valid" }, { status: 400 });
      }
    }

    const result = await restoreRun(runId, targetConnId);

    if (!result.ok) {
      console.error(`[RESTORE] Failed runId=${runId} target=${targetConnId ?? "original"}: ${result.message}`);
    } else if (result.warnings?.length) {
      console.log(`[RESTORE] OK runId=${runId} with ${result.warnings.length} warnings`);
      for (const w of result.warnings.slice(0, 10)) console.warn(`[RESTORE] ${w}`);
    }

    await logActivity({
      teamId: run.job.connection.teamId,
      userId: user.id,
      action: "db-restore",
      status: result.ok ? "success" : "failed",
      message: `Restore "${run.job.name}": ${result.message}`,
    });

    return NextResponse.json(
      result.ok
        ? { ok: true, message: result.message, warnings: result.warnings }
        : { ok: false, message: result.message, warnings: result.warnings },
      { status: result.ok ? 200 : 400 },
    );
  } catch (e) {
    console.error("[RESTORE] Unhandled error:", e);
    return NextResponse.json(
      { ok: false, message: `Terjadi kesalahan server: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
