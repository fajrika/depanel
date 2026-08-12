import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam, canUseFeature } from "@/lib/team";
import { logActivity } from "@/lib/power";

const createSchema = z.object({
  name: z.string().min(1),
  sshId: z.string().min(1),
  command: z.string().min(1),
  intervalMin: z.coerce.number().int().min(1).max(1440).default(1),
  timeoutSec: z.coerce.number().int().min(1).max(300).default(30),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (!(await canUseFeature(user.id, team.id, "ssh"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuka App Health" }, { status: 403 });
  }

  // dikelompokkan per koneksi SSH
  const sshs = await prisma.sshConnection.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      host: true,
      sshHealthChecks: { orderBy: { createdAt: "asc" } },
    },
  });

  return NextResponse.json({
    ok: true,
    data: sshs
      .filter((s) => s.sshHealthChecks.length > 0)
      .map((s) => ({
        ssh: { id: s.id, name: s.name, host: s.host },
        checks: s.sshHealthChecks,
      })),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (!(await canUseFeature(user.id, team.id, "ssh"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuat App Health" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;

  const ssh = await prisma.sshConnection.findUnique({ where: { id: d.sshId }, select: { teamId: true } });
  if (!ssh?.teamId || ssh.teamId !== team.id) {
    return NextResponse.json({ ok: false, message: "Koneksi SSH tidak ditemukan" }, { status: 400 });
  }

  const hc = await prisma.sshHealthCheck.create({
    data: {
      teamId: team.id,
      name: d.name,
      sshId: d.sshId,
      command: d.command,
      intervalMin: d.intervalMin,
      timeoutSec: d.timeoutSec,
    },
  });
  await logActivity({ teamId: team.id, userId: user.id, action: "sshhealth-create", message: `Buat app health "${d.name}"` });
  return NextResponse.json({ ok: true, data: { id: hc.id } });
}
