import { NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
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
  if (run.job.destType !== "local" || !run.location) {
    return NextResponse.json({ ok: false, message: "Hanya arsip tujuan Lokal yang bisa diunduh dari panel" }, { status: 400 });
  }
  try {
    await fsp.access(run.location);
  } catch {
    return NextResponse.json({ ok: false, message: "File tidak ditemukan" }, { status: 404 });
  }
  const name = path.basename(run.location);
  const stream = fs.createReadStream(run.location) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
