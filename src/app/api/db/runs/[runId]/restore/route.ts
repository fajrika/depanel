import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { restoreRun } from "@/lib/dbbackup";
import { logActivity } from "@/lib/power";

export async function POST(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { runId } = await ctx.params;
  const run = await prisma.dbBackupRun.findUnique({
    where: { id: runId },
    include: { job: { include: { connection: { select: { teamId: true } } } } },
  });
  if (!run?.job.connection.teamId) return NextResponse.json({ ok: false, message: "Run tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, run.job.connection.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  const result = await restoreRun(runId);
  await logActivity({
    teamId: run.job.connection.teamId,
    userId: user.id,
    action: "db-restore",
    status: result.ok ? "success" : "failed",
    message: `Restore "${run.job.name}": ${result.message}`,
  });
  return NextResponse.json(
    result.ok ? { ok: true, message: result.message, warnings: result.warnings } : { ok: false, message: result.message },
    { status: result.ok ? 200 : 400 },
  );
}
