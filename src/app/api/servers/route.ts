import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam, isStaff, membershipOf } from "@/lib/team";
import { desiredState } from "@/lib/schedule";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  const staff = isStaff(team.role);

  // member: sembunyikan server yang di-hide khusus untuknya
  let hideFilter = {};
  if (!staff) {
    const m = await membershipOf(user.id, team.id);
    if (m) hideFilter = { hiddenFor: { none: { memberId: m.id } } };
  }

  const servers = await prisma.server.findMany({
    where: { account: { teamId: team.id }, ...hideFilter },
    orderBy: [{ accountId: "asc" }, { sortOrder: "asc" }, { hostname: "asc" }],
    include: {
      account: { select: { id: true, name: true } },
      schedule: { include: { actions: true } },
    },
  });

  const now = new Date();
  const data = servers.map((s) => {
    const desired = s.schedule
      ? desiredState(
          {
            enabled: s.schedule.enabled,
            timezone: s.schedule.timezone,
            actions: s.schedule.actions.map((a) => ({ days: a.days, time: a.time, action: a.action })),
          },
          now,
        )
      : null;
    return {
      id: s.id,
      uuid: s.uuid,
      hostname: s.hostname,
      status: s.status,
      location: s.location,
      tier: s.tier,
      ipAddress: s.ipAddress,
      cpu: s.cpu,
      memoryMb: s.memoryMb,
      storageGb: s.storageGb,
      managed: s.managed,
      isProduction: s.isProduction,
      lastSyncedAt: s.lastSyncedAt,
      account: s.account,
      scheduleEnabled: s.schedule?.enabled ?? false,
      actionCount: s.schedule?.actions.length ?? 0,
      desiredState: desired,
    };
  });
  return NextResponse.json({ ok: true, data, team: { id: team.id, name: team.name } });
}
