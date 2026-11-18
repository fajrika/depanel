import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/power";
import { countItems, parseItems } from "@/lib/customreport";
import { loadOwnReport, reportSchema } from "../_shared";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const own = await loadOwnReport(user, id);
  if (!own) return NextResponse.json({ ok: false, message: "Laporan tidak ditemukan" }, { status: 404 });
  const r = own.report;
  const items = parseItems(r.items);
  return NextResponse.json({ ok: true, data: { id: r.id, name: r.name, description: r.description, rangeDays: r.rangeDays, timezone: r.timezone, items, itemCount: countItems(items), createdAt: r.createdAt, updatedAt: r.updatedAt } });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const own = await loadOwnReport(user, id);
  if (!own) return NextResponse.json({ ok: false, message: "Laporan tidak ditemukan" }, { status: 404 });
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;
  await prisma.customReport.update({
    where: { id },
    data: { name: d.name, description: d.description || null, rangeDays: d.rangeDays, timezone: d.timezone, items: JSON.stringify(parseItems(JSON.stringify(d.items))) },
  });
  await logActivity({ teamId: own.team.id, userId: user.id, action: "report-update", message: `Ubah laporan "${d.name}"` });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const own = await loadOwnReport(user, id);
  if (!own) return NextResponse.json({ ok: false, message: "Laporan tidak ditemukan" }, { status: 404 });
  await prisma.customReport.delete({ where: { id } });
  await logActivity({ teamId: own.team.id, userId: user.id, action: "report-delete", message: `Hapus laporan "${own.report.name}"` });
  return NextResponse.json({ ok: true });
}
