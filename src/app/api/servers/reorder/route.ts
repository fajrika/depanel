import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam, isStaff } from "@/lib/team";

const schema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

/** Simpan urutan server tim aktif (owner/admin). `ids` = urutan baru. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (!isStaff(team.role)) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Data tidak valid" }, { status: 400 });

  // hanya server milik tim aktif yang boleh diubah urutannya
  const owned = await prisma.server.findMany({
    where: { id: { in: parsed.data.ids }, account: { teamId: team.id } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((s) => s.id));

  await prisma.$transaction(
    parsed.data.ids
      .filter((id) => ownedIds.has(id))
      .map((id, index) => prisma.server.update({ where: { id }, data: { sortOrder: index } })),
  );
  return NextResponse.json({ ok: true });
}
