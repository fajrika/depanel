import { NextResponse } from "next/server";
import { z } from "zod";
import { accountStaffCtx } from "@/lib/server-guard";
import { logActivity } from "@/lib/power";

const patchSchema = z.union([
  z.object({ op: z.literal("attach"), instance_id: z.string().min(1) }),
  z.object({ op: z.literal("detach") }),
  z.object({ op: z.literal("resize"), size: z.number().int().min(10) }),
]);

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string; blockId: string }> }) {
  const { id, blockId } = await ctx.params;
  const c = await accountStaffCtx(id);
  if (c instanceof Response) return c;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  try {
    if (parsed.data.op === "attach") await c.client.blockAttach(blockId, parsed.data.instance_id);
    else if (parsed.data.op === "detach") await c.client.blockDetach(blockId);
    else await c.client.blockResize(blockId, parsed.data.size);
    await logActivity({ teamId: c.teamId, userId: c.user.id, action: `block-${parsed.data.op}`, message: `Block ${blockId}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; blockId: string }> }) {
  const { id, blockId } = await ctx.params;
  const c = await accountStaffCtx(id);
  if (c instanceof Response) return c;
  try {
    await c.client.blockDelete(blockId);
    await logActivity({ teamId: c.teamId, userId: c.user.id, action: "block-delete", message: `Hapus block ${blockId}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
