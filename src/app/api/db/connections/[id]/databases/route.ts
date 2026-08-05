import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
import { connCfgFrom, listDatabases } from "@/lib/dbbackup";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const conn = await prisma.dbConnection.findUnique({ where: { id }, include: { ssh: true } });
  if (!conn?.teamId) return NextResponse.json({ ok: false, message: "Koneksi tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, conn.teamId, "backupDb"))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  try {
    const dbs = await listDatabases(connCfgFrom(conn));
    return NextResponse.json({ ok: true, data: dbs });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
