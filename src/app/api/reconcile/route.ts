import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { reconcileAll, logActivity } from "@/lib/power";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  try {
    const actions = await reconcileAll(new Date());
    await logActivity({
      userId: user.id,
      action: "reconcile-now",
      source: "web",
      message: `manual reconcile: ${actions.length} aksi`,
    });
    return NextResponse.json({ ok: true, data: actions });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
