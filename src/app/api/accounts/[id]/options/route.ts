import { NextResponse } from "next/server";
import { accountStaffCtx } from "@/lib/server-guard";

/** Options needed to create an instance: locations, tiers, OS systems, size templates. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await accountStaffCtx(id);
  if (c instanceof Response) return c;
  try {
    const [locations, tiers, systems, sizes] = await Promise.all([
      c.client.locations().catch(() => []),
      c.client.tiers().catch(() => []),
      c.client.systems().catch(() => []),
      c.client.sizeTemplate().catch(() => []),
    ]);
    return NextResponse.json({ ok: true, data: { locations, tiers, systems, sizes } });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
