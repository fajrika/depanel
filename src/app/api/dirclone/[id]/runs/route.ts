import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const job = await prisma.dirCloneJob.findUnique({ where: { id } });
  if (!job?.teamId) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, job.teamId, "backupDb"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin" }, { status: 403 });
  }

  const runs = await prisma.dirCloneRun.findMany({
    where: { jobId: id },
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ ok: true, data: runs });
}
