import { NextResponse } from "next/server";
import { z } from "zod";
import { serverCtx } from "@/lib/server-guard";
import { logActivity } from "@/lib/power";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await serverCtx(id);
  if (c instanceof Response) return c;
  try {
    const [rules, def, types] = await Promise.all([
      c.client.firewallRules(c.server.uuid),
      c.client.firewallDefault(c.server.uuid).catch(() => null),
      c.client.firewallRuleTypes().catch(() => null),
    ]);
    return NextResponse.json({ ok: true, data: { rules, default: def, types } });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}

const createSchema = z.object({
  destination_port: z.string().min(1),
  action: z.string().min(1), // "A" accept / "D" drop, per depa
  protocol: z.string().min(1), // tcp/udp
  description: z.string().default(""),
  source_ip: z.string().default(""),
  use_ipset: z.boolean().default(false),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await serverCtx(id, { staffOnly: true });
  if (c instanceof Response) return c;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  try {
    const data = await c.client.firewallCreate(c.server.uuid, parsed.data);
    await logActivity({ teamId: c.server.teamId, userId: c.user.id, serverId: id, action: "firewall-create", message: `Rule ${parsed.data.protocol}/${parsed.data.destination_port} @ ${c.server.hostname}` });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
