import { NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
import { fetchBackup, decompressBackup, destCfgFrom } from "@/lib/dbbackup";

export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { runId } = await ctx.params;
  const run = await prisma.dbBackupRun.findUnique({
    where: { id: runId },
    include: { job: { include: { connection: { select: { teamId: true } } } } },
  });
  if (!run?.job.connection.teamId) return NextResponse.json({ ok: false, message: "Run tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, run.job.connection.teamId, "backupDb"))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }
  if (!run.location) {
    return NextResponse.json({ ok: false, message: "Run ini tidak punya arsip" }, { status: 400 });
  }

  const url = new URL(req.url);
  const asPlain = url.searchParams.get("format") === "sql";

  let tmpFile: string | null = null;
  try {
    const destCfg = await destCfgFrom(run.job);
    const file = await fetchBackup(run.job.destType, destCfg, run.location, run.job.destId ?? undefined);
    if (file !== run.location) tmpFile = file; // fetched from FTP/S3, needs cleanup

    const base = path.basename(run.location).replace(/\.(sql|sql\.gz|sql\.br|sql\.xz)$/, "");

    if (asPlain) {
      // Decompress to plain .sql for manual import (TablePlus, etc.)
      const buf = await decompressBackup(file);
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/sql",
          "Content-Disposition": `attachment; filename="${base}.sql"`,
        },
      });
    }

    const rawExt = path.basename(run.location).match(/\.(sql|sql\.gz|sql\.br|sql\.xz)$/)?.[1] ?? "sql.br";
    const stream = fs.createReadStream(file) as unknown as ReadableStream;
    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${base}.${rawExt}"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 500 });
  } finally {
    if (tmpFile) await fsp.rm(tmpFile, { force: true }).catch(() => {});
  }
}
