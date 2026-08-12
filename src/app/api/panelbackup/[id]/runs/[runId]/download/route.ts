import { NextResponse } from "next/server";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { fetchRunFile } from "@/lib/panelbackup";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id, runId } = await ctx.params;
  const run = await prisma.panelBackupRun.findUnique({
    where: { id: runId },
    include: { panelBackup: true },
  });
  if (!run?.panelBackup.teamId) return NextResponse.json({ ok: false, message: "Run tidak ditemukan" }, { status: 404 });
  if (!(await staffOf(user.id, run.panelBackup.teamId))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }
  if (run.status !== "success" || !run.location) {
    return NextResponse.json({ ok: false, message: "Run ini tidak punya arsip" }, { status: 400 });
  }

  let file: string;
  let cleanup = false;
  if (run.panelBackup.destType === "local") {
    try {
      await fsp.access(run.location);
    } catch {
      return NextResponse.json({ ok: false, message: "File lokal tidak ditemukan" }, { status: 404 });
    }
    file = run.location;
  } else {
    const tmp = path.join(os.tmpdir(), `panel-dl-${Date.now()}.db`);
    try {
      file = await fetchRunFile(run, tmp);
      cleanup = true;
    } catch (e) {
      return NextResponse.json({ ok: false, message: `Gagal mengambil arsip: ${(e as Error).message}` }, { status: 502 });
    }
  }

  const name = path.basename(run.location).replace(/[^a-zA-Z0-9._-]/g, "_") || "depanel-backup.db";
  const stream = fs.createReadStream(file);
  const res = new Response(stream as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
  if (cleanup) {
    res.headers.set("x-cleanup", "1");
    void fsp.rm(file, { force: true }).catch(() => {});
  }
  return res;
}
