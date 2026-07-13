import { NextResponse } from "next/server";
import { accountStaffCtx } from "@/lib/server-guard";
import { logActivity } from "@/lib/power";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; keyId: string }> }) {
  const { id, keyId } = await ctx.params;
  const c = await accountStaffCtx(id);
  if (c instanceof Response) return c;
  try {
    await c.client.sshKeyDelete(keyId);
    await logActivity({ teamId: c.teamId, userId: c.user.id, action: "ssh-key-delete", message: `Hapus SSH key ${keyId}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
