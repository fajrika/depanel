import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";
import { encryptSecret, decryptSecret, maskKey } from "@/lib/crypto";
import { depaClient } from "@/lib/depa";
import { syncAccount, logActivity } from "@/lib/power";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member") return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });

  const accounts = await prisma.depaAccount.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { servers: true } } },
  });
  const data = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    active: a.active,
    lastSyncedAt: a.lastSyncedAt,
    serverCount: a._count.servers,
    maskedKey: (() => {
      try {
        return maskKey(decryptSecret(a.apiKeyEnc));
      } catch {
        return "••••";
      }
    })(),
  }));
  return NextResponse.json({ ok: true, data, team: { id: team.id, name: team.name } });
}

const createSchema = z.object({ name: z.string().min(1), apiKey: z.string().min(8) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member") return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  const { name, apiKey } = parsed.data;

  // Validate the key against depa before saving.
  try {
    await depaClient(apiKey).listInstances();
  } catch (e) {
    return NextResponse.json({ ok: false, message: `API key ditolak depa: ${(e as Error).message}` }, { status: 400 });
  }

  const account = await prisma.depaAccount.create({
    data: { name, teamId: team.id, apiKeyEnc: encryptSecret(apiKey) },
  });
  await logActivity({ teamId: team.id, userId: user.id, action: "account-create", message: `Tambah akun API "${name}"` });
  // Initial sync of its servers.
  let synced = 0;
  try {
    synced = await syncAccount(account.id);
  } catch {
    /* ignore sync error at creation */
  }
  return NextResponse.json({ ok: true, data: { id: account.id, synced } });
}
