import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
import { runSshCommandJob } from "@/lib/sshcmd";
import { logActivity } from "@/lib/power";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const job = await prisma.sshCommandJob.findUnique({ where: { id } });
  if (!job?.teamId) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, job.teamId, "ssh"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin menjalankan job" }, { status: 403 });
  }

  const activeRun = await prisma.sshCommandRun.findFirst({ where: { jobId: id, status: "running" } });
  if (activeRun && Date.now() - new Date(activeRun.startedAt).getTime() < 60 * 60 * 1000) {
    return NextResponse.json({ ok: false, message: "Job sedang berjalan" }, { status: 409 });
  }

  await logActivity({ teamId: job.teamId, userId: user.id, action: "sshcmd-run", message: `Jalankan SSH command "${job.name}"` });
  // fire-and-forget: hasil terekam di SshCommandRun
  void runSshCommandJob(id, "manual").catch((e) => {
    console.error(`[SSHCMD] Job "${job.name}" gagal dijalankan: ${(e as Error).message}`);
  });
  return NextResponse.json({ ok: true, data: { started: true } });
}
