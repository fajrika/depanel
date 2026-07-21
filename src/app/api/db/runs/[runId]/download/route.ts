import { NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { fetchBackup, type DestConfig } from "@/lib/dbbackup";
import { decryptSecret } from "@/lib/crypto";

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
  if (!run.location) {
    return NextResponse.json({ ok: false, message: "Run ini tidak punya arsip" }, { status: 400 });
  }

  const isLocal = run.job.destType === "local";
  let tmpFile: string | null = null;
  try {
    const destCfg = JSON.parse(run.job.destConfig) as DestConfig;
    const file = await fetchBackup(run.job.destType, destCfg, run.location);
    if (file !== run.location) tmpFile = file; // fetched from FTP/S3, needs cleanup

    const name = `backup-${run.id}.sql.gz`;
    const stream = fs.createReadStream(file) as unknown as ReadableStream;
    return new Response(stream, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 500 });
  } finally {
    if (tmpFile) await fsp.rm(tmpFile, { force: true }).catch(() => {});
  }
}
