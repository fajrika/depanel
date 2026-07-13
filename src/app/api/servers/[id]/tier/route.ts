import { NextResponse } from "next/server";
import { z } from "zod";
import { serverCtx } from "@/lib/server-guard";
import { logActivity } from "@/lib/power";

/** GET tiers (+ optional price preview via ?tier_id=). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await serverCtx(id, { staffOnly: true });
  if (c instanceof Response) return c;
  const tierId = new URL(request.url).searchParams.get("tier_id");
  try {
    const tiers = await c.client.tiers();
    const price = tierId ? await c.client.changeTierPrice(c.server.uuid, Number(tierId)).catch(() => null) : null;
    return NextResponse.json({ ok: true, data: { tiers, price } });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}

const schema = z.object({ tier_id: z.number().int() });

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await serverCtx(id, { staffOnly: true });
  if (c instanceof Response) return c;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  try {
    const data = await c.client.changeTier(c.server.uuid, parsed.data.tier_id);
    await logActivity({ teamId: c.server.teamId, userId: c.user.id, serverId: id, action: "change-tier", message: `Ganti tier → ${parsed.data.tier_id} @ ${c.server.hostname}` });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
