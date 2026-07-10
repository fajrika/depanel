import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";
import { syncAccount, logActivity } from "@/lib/power";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);

  const accounts = await prisma.depaAccount.findMany({ where: { teamId: team.id, active: true } });
  const results = await Promise.all(
    accounts.map(async (a) => {
      try {
        const synced = await syncAccount(a.id);
        return { accountName: a.name, ok: true, synced };
      } catch (e) {
        return { accountName: a.name, ok: false, message: (e as Error).message };
      }
    }),
  );
  await logActivity({
    teamId: team.id,
    userId: user.id,
    action: "sync-all",
    source: "web",
    message: `sync ${accounts.length} akun`,
  });
  return NextResponse.json({ ok: true, data: results });
}
