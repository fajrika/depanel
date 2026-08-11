import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canUseFeature } from "@/lib/team";
import { getHealthHistory } from "@/lib/healthcheck";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const hc = await prisma.healthCheck.findUnique({ where: { id } });
  if (!hc?.teamId) return NextResponse.json({ ok: false, message: "Health check tidak ditemukan" }, { status: 404 });
  if (!(await canUseFeature(user.id, hc.teamId, "infra"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin" }, { status: 403 });
  }

  const hours = Math.min(Number(new URL(request.url).searchParams.get("hours") ?? 24), 720);
  const data = await getHealthHistory(id, hours);
  return NextResponse.json({ ok: true, data });
}
