import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam, canUseFeature } from "@/lib/team";
import { logActivity } from "@/lib/power";
import { getHealthHistory } from "@/lib/healthcheck";
import { isWithinActiveWindow, isValidTimezone, describeWindow } from "@/lib/healthcheck-window";

const createSchema = z.object({
  name: z.string().min(1),
  url: z.string().url("URL tidak valid").refine((u) => u.startsWith("http://") || u.startsWith("https://"), "Hanya URL http(s) yang didukung"),
  group: z.string().optional().default(""),
  groupId: z.string().optional().default(""),
  method: z.enum(["GET", "HEAD", "POST"]).default("GET"),
  expectedStatus: z.coerce.number().int().min(100).max(599).default(200),
  intervalMin: z.coerce.number().int().min(1).max(1440).default(1),
  timeoutSec: z.coerce.number().int().min(1).max(120).default(10),
  scheduleMode: z.enum(["always", "only", "skip"]).default("always"),
  windowStart: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Format jam harus HH:MM").nullable().optional(),
  windowEnd: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Format jam harus HH:MM").nullable().optional(),
  timezone: z.string().refine(isValidTimezone, "Zona waktu tidak valid").default("Asia/Jakarta"),
}).refine((d) => d.scheduleMode === "always" || (d.windowStart && d.windowEnd && d.windowStart !== d.windowEnd), {
  message: "Jam mulai & selesai jadwal wajib diisi dan tidak boleh sama",
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
    include: { group: { select: { id: true, name: true } } },
  });
  const data = await Promise.all(
    checks.map(async (c) => {
      const history = await getHealthHistory(c.id, 24, c);
      return {
        ...c,
        group: c.group ?? null,
        uptimePct: history.uptimePct,
        inWindow: isWithinActiveWindow(c),
        windowLabel: describeWindow(c),
      };
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

  if (d.groupId) {
    const g = await prisma.healthGroup.findUnique({ where: { id: d.groupId }, select: { teamId: true } });
    if (!g?.teamId || g.teamId !== team.id) {
      return NextResponse.json({ ok: false, message: "Grup tidak ditemukan" }, { status: 400 });
    }
  }

  const check = await prisma.healthCheck.create({
    data: { teamId: team.id, name: d.name, url: d.url, groupId: d.groupId || null, method: d.method, expectedStatus: d.expectedStatus, intervalMin: d.intervalMin, timeoutSec: d.timeoutSec, scheduleMode: d.scheduleMode, windowStart: d.scheduleMode === "always" ? null : d.windowStart, windowEnd: d.scheduleMode === "always" ? null : d.windowEnd, timezone: d.timezone },
  });
  await logActivity({ teamId: team.id, userId: user.id, action: "healthcheck-create", message: `Buat health check "${d.name}"` });
  return NextResponse.json({ ok: true, data: { id: check.id } });
}
