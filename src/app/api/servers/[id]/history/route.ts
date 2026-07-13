import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canTouchServer } from "@/lib/team";
import { getServerHistory } from "@/lib/metrics";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await canTouchServer(user.id, id))) {
    return NextResponse.json({ ok: false, message: "Anda tidak punya akses ke server ini" }, { status: 403 });
  }
  const hours = Math.min(Number(new URL(request.url).searchParams.get("hours") ?? 24), 720);
  const data = await getServerHistory(id, hours);
  return NextResponse.json({ ok: true, data });
}
