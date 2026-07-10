import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);

  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit") ?? 100), 500);
  const logs = await prisma.activityLog.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      user: { select: { name: true, email: true } },
      server: { select: { hostname: true } },
    },
  });
  return NextResponse.json({ ok: true, data: logs, team: { id: team.id, name: team.name } });
}
