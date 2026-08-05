import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
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
    if (!(await canUseFeature(user.id, run.job.connection.teamId, "backupDb"))) {
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

    // Check if there's already a running restore for this run
    const existing = await prisma.dbRestoreRun.findFirst({
      where: { runId, status: "running" },
    });
    if (existing) {
      return NextResponse.json({ ok: true, data: { restoreId: existing.id, status: "running" } });
    }

    // Create restore record and fire-and-forget
    const restore = await prisma.dbRestoreRun.create({
      data: {
        teamId: run.job.connection.teamId,
        userId: user.id,
        runId,
        targetConnId: targetConnId ?? null,
      },
    });

    await logActivity({
      teamId: run.job.connection.teamId,
      userId: user.id,
      action: "db-restore",
      message: `Mulai restore "${run.job.name}"`,
    });

    // Background: run restore, update record when done
    void (async () => {
      try {
        const result = await restoreRun(runId, targetConnId, restore.id);
        await prisma.dbRestoreRun.update({
          where: { id: restore.id },
          data: {
            status: result.ok ? "success" : "failed",
            message: result.message,
            warnings: result.warnings ? JSON.stringify(result.warnings) : null,
            endedAt: new Date(),
          },
        });

        if (!result.ok) {
          console.error(`[RESTORE] Failed restoreId=${restore.id} runId=${runId}: ${result.message}`);
        } else if (result.warnings?.length) {
          console.log(`[RESTORE] OK restoreId=${restore.id} with ${result.warnings.length} warnings`);
        }
      } catch (e) {
        console.error(`[RESTORE] Unhandled restoreId=${restore.id}:`, e);
        await prisma.dbRestoreRun.update({
          where: { id: restore.id },
          data: { status: "failed", message: (e as Error).message, endedAt: new Date() },
        });
      }
    })();

    return NextResponse.json({ ok: true, data: { restoreId: restore.id, status: "running" } });
  } catch (e) {
    console.error("[RESTORE] Unhandled error:", e);
    return NextResponse.json(
      { ok: false, message: `Terjadi kesalahan server: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
