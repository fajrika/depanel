import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { deleteRun } from "@/lib/dbbackup";

async function guard(userId: string, runId: string) {
  const run = await prisma.dbBackupRun.findUnique({
    where: { id: runId },
    include: { job: { include: { connection: { select: { teamId: true } } } } },
  });
  if (!run?.job.connection.teamId) return null;
  if (!(await staffOf(userId, run.job.connection.teamId))) return null;
  return run;
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { runId } = await ctx.params;
  if (!(await guard(user.id, runId))) return NextResponse.json({ ok: false, message: "Tidak diizinkan" }, { status: 403 });
  await deleteRun(runId);
  return NextResponse.json({ ok: true });
}
