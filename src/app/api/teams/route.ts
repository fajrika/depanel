import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/power";

/** Daftar tim milik user + detail member (untuk halaman Tim). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id },
    include: {
      team: {
        include: {
          members: {
            include: {
              user: { select: { id: true, name: true, email: true } },
              serverHides: { select: { serverId: true } },
            },
          },
          accounts: { select: { id: true, name: true, servers: { select: { id: true, hostname: true }, orderBy: { sortOrder: "asc" } } } },
        },
      },
    },
  });
  const data = memberships
    .map((m) => ({
      id: m.team.id,
      name: m.team.name,
      isPersonal: m.team.isPersonal,
      myRole: m.role,
      members: m.team.members.map((x) => ({
        id: x.user.id,
        name: x.user.name,
        email: x.user.email,
        role: x.role,
        canViewBilling: x.role !== "member" || x.canViewBilling,
        canSchedule: x.role !== "member" || x.canSchedule,
        canBackup: x.role !== "member" || x.canBackup,
        hiddenServerIds: x.serverHides.map((h) => h.serverId),
      })),
      accounts: m.team.accounts.map((a) => ({ id: a.id, name: a.name })),
      servers: m.team.accounts.flatMap((a) => a.servers),
    }))
    .sort((a, b) => (a.isPersonal === b.isPersonal ? a.name.localeCompare(b.name) : a.isPersonal ? -1 : 1));
  return NextResponse.json({ ok: true, data });
}

const createSchema = z.object({ name: z.string().min(1) });

/** Semua user boleh membuat tim; pembuat otomatis owner. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Nama tim wajib diisi" }, { status: 400 });

  const team = await prisma.team.create({
    data: {
      name: parsed.data.name,
      members: { create: { userId: user.id, role: "owner", canViewBilling: true } },
    },
  });
  await logActivity({ teamId: team.id, userId: user.id, action: "team-create", message: `Buat tim ${team.name}` });
  return NextResponse.json({ ok: true, data: { id: team.id } });
}
