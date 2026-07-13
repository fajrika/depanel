import { NextResponse } from "next/server";
import { z } from "zod";
import { accountStaffCtx } from "@/lib/server-guard";
import { logActivity } from "@/lib/power";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await accountStaffCtx(id);
  if (c instanceof Response) return c;
  const loc = new URL(request.url).searchParams.get("location_id");
  try {
    const [blocks, options] = await Promise.all([
      c.client.blocks(loc ? { location_id: Number(loc), limit: 100 } : { limit: 100 }),
      loc ? c.client.blockOptions(Number(loc)).catch(() => null) : Promise.resolve(null),
    ]);
    return NextResponse.json({ ok: true, data: { blocks, options } });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}

const schema = z.object({
  name: z.string().min(1),
  location_id: z.number().int(),
  storage_type: z.number().int(),
  size: z.string().min(1),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await accountStaffCtx(id);
  if (c instanceof Response) return c;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  try {
    const data = await c.client.blockCreate(parsed.data);
    await logActivity({ teamId: c.teamId, userId: c.user.id, action: "block-create", message: `Buat block storage "${parsed.data.name}" (${parsed.data.size}GB)` });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
