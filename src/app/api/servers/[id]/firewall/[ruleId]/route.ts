import { NextResponse } from "next/server";
import { serverCtx } from "@/lib/server-guard";
import { logActivity } from "@/lib/power";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; ruleId: string }> }) {
  const { id, ruleId } = await ctx.params;
  const c = await serverCtx(id, { staffOnly: true });
  if (c instanceof Response) return c;
  try {
    await c.client.firewallDelete(c.server.uuid, ruleId);
    await logActivity({ teamId: c.server.teamId, userId: c.user.id, serverId: id, action: "firewall-delete", message: `Hapus rule ${ruleId} @ ${c.server.hostname}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
