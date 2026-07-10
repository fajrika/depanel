import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canTouchServer } from "@/lib/team";
import { clientForAccount, logActivity } from "@/lib/power";

async function guard(id: string) {
  const user = await getCurrentUser();
  if (!user) return { err: NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 }) };
  if (!(await canTouchServer(user.id, id, "backup"))) {
    return { err: NextResponse.json({ ok: false, message: "Anda tidak diberi izin mengakses backup di tim ini" }, { status: 403 }) };
  }
  const server = await prisma.server.findUnique({ where: { id } });
  if (!server) return { err: NextResponse.json({ ok: false, message: "Server tidak ditemukan" }, { status: 404 }) };
  return { user, server };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if ("err" in g) return g.err;
  try {
    const client = await clientForAccount(g.server.accountId);
    const data = await client.snapshots(g.server.uuid);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}

const createSchema = z.object({ name: z.string().min(1), description: z.string().default("") });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if ("err" in g) return g.err;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Nama snapshot wajib diisi" }, { status: 400 });

  try {
    const client = await clientForAccount(g.server.accountId);
    const data = await client.snapshotCreate(g.server.uuid, {
      name: parsed.data.name,
      description: parsed.data.description || parsed.data.name,
    });
    await logActivity({
      userId: g.user.id,
      serverId: id,
      action: "snapshot-create",
      message: `Snapshot "${parsed.data.name}" @ ${g.server.hostname}`,
    });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
  }
}
