import { NextResponse } from "next/server";
import { z } from "zod";
import { accountStaffCtx } from "@/lib/server-guard";
import { logActivity } from "@/lib/power";

/** GET payment methods for a given amount. */
export async function GET(request: Request, ctx: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await ctx.params;
  const c = await accountStaffCtx(accountId);
  if (c instanceof Response) return c;
  const amount = Number(new URL(request.url).searchParams.get("amount") ?? 100000);
  try {
    const data = await c.client.topupMethods(amount);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}

const schema = z.object({
  amount: z.number().int().min(10000),
  payment_method: z.string().min(1),
  phone_number: z.string().default(""),
  code: z.string().default(""),
});

/**
 * Create a top-up invoice at depa. This does NOT charge anything — it returns a
 * payment instruction / QR / link that the user completes manually in their own
 * payment app. Depanel never moves money itself.
 */
export async function POST(request: Request, ctx: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await ctx.params;
  const c = await accountStaffCtx(accountId);
  if (c instanceof Response) return c;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });
  try {
    const data = await c.client.topupCreate(parsed.data);
    await logActivity({ teamId: c.teamId, userId: c.user.id, action: "topup-invoice", message: `Buat invoice top-up Rp${parsed.data.amount.toLocaleString("id-ID")}` });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
