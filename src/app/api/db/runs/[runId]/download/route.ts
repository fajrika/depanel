import { NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { fetchBackup, type DestConfig } from "@/lib/dbbackup";

export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
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

  const url = new URL(req.url);
  const asPlain = url.searchParams.get("format") === "sql";

  let tmpFile: string | null = null;
  try {
    const destCfg = JSON.parse(run.job.destConfig) as DestConfig;
    const file = await fetchBackup(run.job.destType, destCfg, run.location, run.job.id);
    if (file !== run.location) tmpFile = file; // fetched from FTP/S3, needs cleanup

    const base = path.basename(run.location).replace(/\.(sql\.gz|sql\.br)$/, "");

    if (asPlain) {
      // Detect format via gzip magic bytes, then stream-decompress to plain .sql
      const head = Buffer.alloc(2);
      const fh = fs.openSync(file, "r");
      try {
        fs.readSync(fh, head, 0, 2, 0);
      } finally {
        fs.closeSync(fh);
      }
      const isGzip = head[0] === 0x1f && head[1] === 0x8b;
      const decompress = isGzip ? zlib.createGunzip() : zlib.createBrotliDecompress();
      const stream = fs.createReadStream(file).pipe(decompress) as unknown as ReadableStream;
      return new Response(stream, {
        headers: {
          "Content-Type": "application/sql",
          "Content-Disposition": `attachment; filename="${base}.sql"`,
        },
      });
    }

    const name = `${base}.sql.br`;
    const stream = fs.createReadStream(file) as unknown as ReadableStream;
    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 500 });
  } finally {
    if (tmpFile) await fsp.rm(tmpFile, { force: true }).catch(() => {});
  }
}
