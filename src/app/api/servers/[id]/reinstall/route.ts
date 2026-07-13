import { NextResponse } from "next/server";
import { z } from "zod";
import { serverCtx } from "@/lib/server-guard";
import { logActivity } from "@/lib/power";

/** GET available OS templates. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await serverCtx(id, { staffOnly: true });
  if (c instanceof Response) return c;
  try {
    const systems = await c.client.systems();
    return NextResponse.json({ ok: true, data: { systems } });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}

const schema = z.object({
  template_id: z.number().int(),
  username: z.string().min(1).default("root"),
  password: z.string().min(6),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await serverCtx(id, { staffOnly: true });
  if (c instanceof Response) return c;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  try {
    const data = await c.client.reinstall(c.server.uuid, parsed.data);
    await logActivity({ teamId: c.server.teamId, userId: c.user.id, serverId: id, action: "reinstall", message: `Reinstall OS (template ${parsed.data.template_id}) @ ${c.server.hostname}` });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
