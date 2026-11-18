import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { parseRunFilter, runWhere } from "@/lib/sshcmd-report";

const MAX_PAGE_SIZE = 100;

/**
 * Riwayat eksekusi satu job, dipaginasi (tanpa batas ke belakang).
 * Query: page (mulai 1), pageSize (default 10, maks 100), status, from, to (ISO / YYYY-MM-DD).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const job = await prisma.sshCommandJob.findUnique({ where: { id }, select: { teamId: true } });
  if (!job?.teamId) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });
  const member = await prisma.teamMember.findFirst({ where: { userId: user.id, teamId: job.teamId }, select: { teamId: true } });
  if (!member) return NextResponse.json({ ok: false, message: "Job tidak ditemukan" }, { status: 404 });

  const sp = new URL(request.url).searchParams;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(sp.get("pageSize")) || 10));
  const filter = parseRunFilter(sp);
  const where = runWhere(id, filter);

  const total = await prisma.sshCommandRun.count({ where });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(sp.get("page")) || 1)));
  const runs = await prisma.sshCommandRun.findMany({
    where,
    orderBy: { startedAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: { id: true, status: true, exitCode: true, output: true, error: true, startedAt: true, endedAt: true },
  });
  return NextResponse.json({ ok: true, data: runs, page, pageSize, total, pages });
}
