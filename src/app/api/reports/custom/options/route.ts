import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";
import { accessFor, listOptions } from "@/lib/customreport";

/** Item yang bisa dipilih untuk laporan gabungan (sesuai izin user). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  const access = await accessFor(user.id, team.id);
  if (!access) return NextResponse.json({ ok: false, message: "Bukan anggota tim" }, { status: 403 });
  const data = await listOptions(team.id, access);
  return NextResponse.json({ ok: true, data });
}
