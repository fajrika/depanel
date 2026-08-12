import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam, canUseFeature } from "@/lib/team";
import { logActivity } from "@/lib/power";
import { getHealthHistory } from "@/lib/healthcheck";

const createSchema = z.object({
  name: z.string().min(1),
  url: z.string().url("URL tidak valid").refine((u) => u.startsWith("http://") || u.startsWith("https://"), "Hanya URL http(s) yang didukung"),
  group: z.string().optional().default(""),
  method: z.enum(["GET", "HEAD", "POST"]).default("GET"),
  expectedStatus: z.coerce.number().int().min(100).max(599).default(200),
  intervalMin: z.coerce.number().int().min(1).max(1440).default(1),
  timeoutSec: z.coerce.number().int().min(1).max(120).default(10),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (!(await canUseFeature(user.id, team.id, "infra"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuka Health Check" }, { status: 403 });
  }

  const checks = await prisma.healthCheck.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: "asc" },
  });
  const data = await Promise.all(
    checks.map(async (c) => {
      const history = await getHealthHistory(c.id, 24);
      return { ...c, uptimePct: history.uptimePct };
    }),
  );
  return NextResponse.json({ ok: true, data });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (!(await canUseFeature(user.id, team.id, "infra"))) {
    return NextResponse.json({ ok: false, message: "Anda tidak diberi izin membuat health check" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;

  const check = await prisma.healthCheck.create({
    data: { teamId: team.id, name: d.name, url: d.url, group: d.group || null, method: d.method, expectedStatus: d.expectedStatus, intervalMin: d.intervalMin, timeoutSec: d.timeoutSec },
  });
  await logActivity({ teamId: team.id, userId: user.id, action: "healthcheck-create", message: `Buat health check "${d.name}"` });
  return NextResponse.json({ ok: true, data: { id: check.id } });
}
