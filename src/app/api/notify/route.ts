import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member") return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });

  const channels = await prisma.notifyChannel.findMany({ where: { teamId: team.id }, orderBy: { createdAt: "asc" } });
  const full = await prisma.team.findUnique({ where: { id: team.id }, select: { lowBalanceThreshold: true } });
  // never return secret tokens to the browser — but expose non-secret fields so the
  // channel can be edited (chat ID / webhook URL) without re-entering the token.
  const data = channels.map((c) => {
    let cfg: Record<string, string> = {};
    try {
      cfg = JSON.parse(c.config);
    } catch {
      /* config rusak */
    }
    return {
      id: c.id,
      type: c.type,
      label: c.label,
      onPower: c.onPower,
      onBackup: c.onBackup,
      onError: c.onError,
      onBalance: c.onBalance,
      enabled: c.enabled,
      chatId: cfg.chatId ?? "",
      url: cfg.url ?? "",
      hasToken: !!cfg.botToken,
    };
  });
  return NextResponse.json({ ok: true, data, lowBalanceThreshold: full?.lowBalanceThreshold ?? null });
}

const createSchema = z.object({
  type: z.enum(["telegram", "discord", "webhook"]),
  label: z.string().min(1),
  config: z.record(z.string(), z.string()),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member") return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  const { type, label, config } = parsed.data;

  // minimal validation of required config per type
  if (type === "telegram" && (!config.botToken || !config.chatId)) {
    return NextResponse.json({ ok: false, message: "Telegram butuh botToken & chatId" }, { status: 400 });
  }
  if ((type === "discord" || type === "webhook") && !config.url) {
    return NextResponse.json({ ok: false, message: "Butuh URL webhook" }, { status: 400 });
  }

  const created = await prisma.notifyChannel.create({
    data: { teamId: team.id, type, label, config: JSON.stringify(config) },
  });
  return NextResponse.json({ ok: true, data: { id: created.id } });
}

const settingsSchema = z.object({ lowBalanceThreshold: z.number().int().min(0).nullable() });

/** PATCH the team's low-balance threshold. */
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member") return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  await prisma.team.update({ where: { id: team.id }, data: { lowBalanceThreshold: parsed.data.lowBalanceThreshold } });
  return NextResponse.json({ ok: true });
}
