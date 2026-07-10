import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { runJob } from "@/lib/dbbackup";
import { logActivity } from "@/lib/power";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const job = await prisma.dbBackupJob.findUnique({
    where: { id },
    include: { connection: { select: { teamId: true } } },
  });
  if (!job?.connection.teamId) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, job.connection.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }
  if (job.lastStatus === "running") {
    return NextResponse.json({ ok: false, message: "Job sedang berjalan" }, { status: 409 });
  }

  await logActivity({
    teamId: job.connection.teamId,
    userId: user.id,
    action: "db-backup-run",
    message: `Jalankan backup "${job.name}"`,
  });
  // fire-and-forget: progress terekam di DbBackupRun
  void runJob(id, "manual");
  return NextResponse.json({ ok: true, data: { started: true } });
}
