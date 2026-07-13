import { NextResponse } from "next/server";
import { z } from "zod";
import { serverCtx } from "@/lib/server-guard";
import { logActivity } from "@/lib/power";

const schema = z.object({
  cpu: z.number().int().min(1).max(64),
  memory: z.number().int().min(1).max(256),
  storage: z.number().int().min(10).max(2000),
  use_dedicated_cpu: z.boolean().default(false),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await serverCtx(id, { staffOnly: true });
  if (c instanceof Response) return c;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  try {
    const data = await c.client.resize(c.server.uuid, parsed.data);
    await logActivity({ teamId: c.server.teamId, userId: c.user.id, serverId: id, action: "resize", message: `Resize ${parsed.data.cpu}CPU/${parsed.data.memory}GB/${parsed.data.storage}GB @ ${c.server.hostname}` });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
