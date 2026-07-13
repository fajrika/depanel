import { NextResponse } from "next/server";
import { z } from "zod";
import { accountStaffCtx } from "@/lib/server-guard";
import { syncAccount, logActivity } from "@/lib/power";

// Passthrough — depa validates the exact combination. We forward known fields.
const schema = z.object({
  hostname: z.string().min(1),
  location_id: z.number().int(),
  template_id: z.number().int(), // OS
  tier_id: z.number().int().optional(),
  cpu: z.number().int().optional(),
  memory: z.number().int().optional(),
  storage: z.number().int().optional(),
  username: z.string().default("root"),
  password: z.string().min(6),
  use_dedicated_cpu: z.boolean().optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await accountStaffCtx(id);
  if (c instanceof Response) return c;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  try {
    const data = await c.client.instanceCreate(parsed.data);
    await logActivity({ teamId: c.teamId, userId: c.user.id, action: "instance-create", message: `Buat instance "${parsed.data.hostname}"` });
    // pull the new server into our DB
    await syncAccount(id).catch(() => {});
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
