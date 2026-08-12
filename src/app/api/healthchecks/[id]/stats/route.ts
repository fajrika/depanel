import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
import { getHealthStats } from "@/lib/healthcheck";

/** Statistik gaya Uptime Kuma: pill strip 24 jam & 30 hari + uptime %. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const hc = await prisma.healthCheck.findUnique({ where: { id } });
  if (!hc?.teamId) return NextResponse.json({ ok: false, message: "Health check tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, hc.teamId, "infra"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin" }, { status: 403 });
  }

  const data = await getHealthStats(id);
  return NextResponse.json({ ok: true, data });
}
