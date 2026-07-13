import { NextResponse } from "next/server";
import { z } from "zod";
import { accountStaffCtx } from "@/lib/server-guard";
import { logActivity } from "@/lib/power";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await accountStaffCtx(id);
  if (c instanceof Response) return c;
  try {
    const keys = await c.client.sshKeys();
    return NextResponse.json({ ok: true, data: keys });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}

const schema = z.object({ title: z.string().min(1), key: z.string().min(20) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await accountStaffCtx(id);
  if (c instanceof Response) return c;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Judul & public key wajib diisi" }, { status: 400 });
  try {
    const data = await c.client.sshKeyCreate(parsed.data);
    await logActivity({ teamId: c.teamId, userId: c.user.id, action: "ssh-key-create", message: `Tambah SSH key "${parsed.data.title}"` });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
