import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireWifi, ensurePresets } from "@/lib/wifi";

export async function GET() {
  const guard = await requireWifi();
  if (!guard.ok) return NextResponse.json({ ok: false, message: guard.message }, { status: guard.status });
  await ensurePresets();
  const presets = await prisma.wifiApPreset.findMany({ orderBy: [{ brand: "asc" }, { model: "asc" }] });
  return NextResponse.json({ ok: true, data: presets });
}
