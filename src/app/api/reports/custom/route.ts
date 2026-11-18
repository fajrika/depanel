import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";
import { logActivity } from "@/lib/power";
import { countItems, parseItems } from "@/lib/customreport";
import { reportSchema } from "./_shared";

/** Daftar laporan gabungan tim aktif. Semua anggota tim boleh melihat. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  const rows = await prisma.customReport.findMany({ where: { teamId: team.id }, orderBy: { updatedAt: "desc" } });
  const data = rows.map((r) => {
    const items = parseItems(r.items);
    return { id: r.id, name: r.name, description: r.description, rangeDays: r.rangeDays, timezone: r.timezone, items, itemCount: countItems(items), createdAt: r.createdAt, updatedAt: r.updatedAt };
  });
  return NextResponse.json({ ok: true, data });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;
  const items = parseItems(JSON.stringify(d.items));
  const r = await prisma.customReport.create({
    data: { teamId: team.id, name: d.name, description: d.description || null, rangeDays: d.rangeDays, timezone: d.timezone, items: JSON.stringify(items), createdById: user.id },
  });
  await logActivity({ teamId: team.id, userId: user.id, action: "report-create", message: `Buat laporan "${d.name}"` });
  return NextResponse.json({ ok: true, data: { id: r.id } });
}
