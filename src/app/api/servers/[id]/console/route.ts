import { NextResponse } from "next/server";
import { serverCtx } from "@/lib/server-guard";
import { logActivity } from "@/lib/power";

/** Request a depa web-console session (returns a websocket URL/token). Staff only. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await serverCtx(id, { staffOnly: true });
  if (c instanceof Response) return c;
  try {
    const data = await c.client.console(c.server.uuid);
    await logActivity({ teamId: c.server.teamId, userId: c.user.id, serverId: id, action: "console", message: `Buka console @ ${c.server.hostname}` });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
