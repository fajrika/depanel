import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canTouchServer } from "@/lib/team";
import { clientForAccount } from "@/lib/power";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!(await canTouchServer(user.id, id))) {
    return NextResponse.json({ ok: false, message: "Anda tidak punya akses ke server ini" }, { status: 403 });
  }
  const periode = new URL(request.url).searchParams.get("periode") ?? "hour";

  const server = await prisma.server.findUnique({ where: { id } });
  if (!server) return NextResponse.json({ ok: false, message: "Server tidak ditemukan" }, { status: 404 });

  try {
    const client = await clientForAccount(server.accountId);
    const data = await client.metrics(server.uuid, periode);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
