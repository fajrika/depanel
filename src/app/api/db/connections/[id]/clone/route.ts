import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { staffOf } from "@/lib/team";
import { encryptSecret } from "@/lib/crypto";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const conn = await prisma.dbConnection.findUnique({ where: { id }, include: { jobs: true } });
  if (!conn?.teamId) return NextResponse.json({ ok: false, message: "Koneksi tidak ditemukan" }, { status: 404 });

  const { teamId } = await req.json();
  if (!teamId) return NextResponse.json({ ok: false, message: "teamId wajib diisi" }, { status: 400 });
  if (teamId === conn.teamId) return NextResponse.json({ ok: false, message: "Koneksi sudah ada di tim ini" }, { status: 400 });
  if (!(await staffOf(user.id, teamId))) {
    return NextResponse.json({ ok: false, message: "Anda bukan admin di tim tujuan" }, { status: 403 });
  }

  // Clone connection to target team
  const newConn = await prisma.dbConnection.create({
    data: {
      teamId,
      name: `${conn.name} (clone)`,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      passwordEnc: conn.passwordEnc, // Same encryption key, same team deployment
    },
  });

  // Clone all jobs (teamId comes from connection relation)
  for (const job of conn.jobs) {
    await prisma.dbBackupJob.create({
      data: {
        connectionId: newConn.id,
        name: `${job.name} (clone)`,
        databases: job.databases,
        scheduleType: job.scheduleType,
        timeAt: job.timeAt,
        dayOn: job.dayOn,
        cronExpr: job.cronExpr,
        destType: job.destType,
        destConfig: job.destConfig,
        enabled: false, // Start disabled
        retention: job.retention,
      },
    });
  }

  return NextResponse.json({ ok: true, data: { id: newConn.id, jobCount: conn.jobs.length } });
}
