import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";
import { clientForAccount } from "@/lib/power";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (!team.canViewBilling) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi akses melihat saldo tim ini" }, { status: 403 });
  }

  const accounts = await prisma.depaAccount.findMany({
    where: { teamId: team.id, active: true },
    orderBy: { createdAt: "asc" },
  });

  const data = await Promise.all(
    accounts.map(async (a) => {
      try {
        const client = await clientForAccount(a.id);
        const summary = await client.billingSummary();
        return { accountId: a.id, accountName: a.name, ok: true, summary };
      } catch (e) {
        return { accountId: a.id, accountName: a.name, ok: false, error: (e as Error).message };
      }
    }),
  );
  return NextResponse.json({ ok: true, data, team: { id: team.id, name: team.name } });
}
