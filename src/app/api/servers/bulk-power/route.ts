import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { powerServer } from "@/lib/power";
import { canTouchServer } from "@/lib/team";

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(["start", "stop", "restart"]),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });

  const results = await Promise.all(
    parsed.data.ids.map(async (id) => {
      if (!(await canTouchServer(user.id, id))) return { id, ok: false, message: "tanpa akses" };
      const r = await powerServer(id, parsed.data.action, { source: "web", userId: user.id });
      return { id, ok: r.ok, message: r.message };
    }),
  );
  return NextResponse.json({ ok: true, data: results });
}
