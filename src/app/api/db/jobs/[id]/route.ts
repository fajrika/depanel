import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";

async function guardJob(userId: string, jobId: string) {
  const job = await prisma.dbBackupJob.findUnique({
    where: { id: jobId },
    include: { connection: { select: { teamId: true } } },
  });
  if (!job?.connection.teamId) return null;
  if (!(await staffOf(userId, job.connection.teamId))) return null;
  return job;
}

const patchSchema = z.object({ enabled: z.boolean().optional() });

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await guardJob(user.id, id))) {
    return NextResponse.json({ ok: false, message: "Job tidak ditemukan / bukan wewenang Anda" }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });

  await prisma.dbBackupJob.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await guardJob(user.id, id))) {
    return NextResponse.json({ ok: false, message: "Job tidak ditemukan / bukan wewenang Anda" }, { status: 403 });
  }
  await prisma.dbBackupJob.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
