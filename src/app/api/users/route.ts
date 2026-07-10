import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { ensurePersonalTeam } from "@/lib/team";
import { logActivity } from "@/lib/power";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, message: "Hanya admin" }, { status: 403 });

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
      teams: { select: { team: { select: { id: true, name: true } } } },
    },
  });
  return NextResponse.json({
    ok: true,
    data: users.map((u) => ({ ...u, teams: u.teams.map((t) => t.team) })),
  });
}

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Password minimal 8 karakter"),
  role: z.enum(["admin", "member"]).default("member"),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, message: "Hanya admin" }, { status: 403 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const { name, email, password, role } = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return NextResponse.json({ ok: false, message: "Email sudah terdaftar" }, { status: 409 });

  const created = await prisma.user.create({
    data: { name, email, passwordHash: await hashPassword(password), role },
  });
  await ensurePersonalTeam(created.id, created.name);
  await logActivity({ userId: user.id, action: "user-create", message: `Daftarkan ${email} (${role})` });
  return NextResponse.json({ ok: true, data: { id: created.id } });
}
