import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam } from "@/lib/team";
import { encryptSecret } from "@/lib/crypto";
import { testConnection } from "@/lib/dbbackup";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member") return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });

  const conns = await prisma.dbConnection.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, host: true, port: true, username: true, createdAt: true, _count: { select: { jobs: true } } },
  });
  return NextResponse.json({ ok: true, data: conns.map((c) => ({ ...c, jobCount: c._count.jobs })) });
}

const createSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(3306),
  username: z.string().min(1),
  password: z.string(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (team.role === "member") return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const { name, host, port, username, password } = parsed.data;

  try {
    await testConnection({ host, port, username, password });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `Koneksi gagal: ${(e as Error).message}` }, { status: 400 });
  }

  const conn = await prisma.dbConnection.create({
    data: { name, host, port, username, passwordEnc: encryptSecret(password), teamId: team.id },
  });
  return NextResponse.json({ ok: true, data: { id: conn.id } });
}
