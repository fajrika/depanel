import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { detectSpeedtestTools, INSTALL_HINT } from "@/lib/speedtest";
import { activeSshTeam } from "../_shared";

/** Cek tool speedtest yang tersedia di server SSH. Body: { sshId } */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { sshId?: string } | null;
  if (!body?.sshId) return NextResponse.json({ ok: false, message: "Koneksi SSH wajib dipilih" }, { status: 400 });
  const { team, allowed } = await activeSshTeam(user);
  if (!allowed) return NextResponse.json({ ok: false, message: "Anda tidak diberi izin" }, { status: 403 });
  const ssh = await prisma.sshConnection.findUnique({ where: { id: body.sshId }, select: { teamId: true } });
  if (!ssh || ssh.teamId !== team.id) return NextResponse.json({ ok: false, message: "Koneksi SSH tidak ditemukan" }, { status: 404 });
  try {
    const r = await detectSpeedtestTools(body.sshId);
    return NextResponse.json({ ok: true, data: { ...r, hint: INSTALL_HINT } });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message || "Gagal terhubung ke server" }, { status: 502 });
  }
}
