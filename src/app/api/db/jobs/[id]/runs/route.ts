import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const job = await prisma.dbBackupJob.findUnique({
    where: { id },
    include: { connection: { select: { teamId: true } } },
  });
  if (!job?.connection.teamId) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, job.connection.teamId, "backupDb"))) {
    return NextResponse.json({ ok: false, message: "Tidak diizinkan" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "10", 10)));
  const skip = (page - 1) * limit;

  const [total, runs] = await Promise.all([
    prisma.dbBackupRun.count({ where: { jobId: id } }),
    prisma.dbBackupRun.findMany({
      where: { jobId: id },
      orderBy: { startedAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    data: runs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
