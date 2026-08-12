import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveTeam, staffOf } from "@/lib/team";

const upsertSchema = z.object({
  name: z.string().min(1).default("Panel Backup"),
  destType: z.enum(["local", "ftp", "s3", "gdrive"]),
  destId: z.string().optional().default(""),
  destPath: z.string().optional().default(""),
  scheduleType: z.enum(["manual", "daily", "weekly", "monthly", "cron"]).default("daily"),
  timeAt: z.string().optional().default("02:00"),
  dayOn: z.coerce.number().int().min(0).max(28).nullable().optional().default(null),
  cronExpr: z.string().optional().default(""),
  timezone: z.string().default("Asia/Jakarta"),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (!(await staffOf(user.id, team.id))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  const backup = await prisma.panelBackup.findFirst({
    where: { teamId: team.id },
    include: { runs: { orderBy: { startedAt: "desc" }, take: 10 } },
  });
  return NextResponse.json({ ok: true, data: backup ?? null });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const team = await getActiveTeam(user);
  if (!(await staffOf(user.id, team.id))) {
    return NextResponse.json({ ok: false, message: "Hanya owner/admin tim" }, { status: 403 });
  }

  const parsed = upsertSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const d = parsed.data;

  if (d.destType !== "local" && d.destId) {
    const dest = await prisma.dbDest.findUnique({ where: { id: d.destId }, select: { teamId: true, type: true } });
    if (!dest?.teamId || dest.teamId !== team.id || dest.type !== d.destType) {
      return NextResponse.json({ ok: false, message: "Koneksi tujuan tidak valid" }, { status: 400 });
    }
  }

  const existing = await prisma.panelBackup.findFirst({ where: { teamId: team.id } });
  const backup = existing
    ? await prisma.panelBackup.update({
        where: { id: existing.id },
        data: {
          name: d.name,
          destType: d.destType,
          destId: d.destType === "local" ? null : d.destId || null,
          destPath: d.destPath || null,
          scheduleType: d.scheduleType,
          timeAt: d.timeAt || null,
          dayOn: d.dayOn ?? null,
          cronExpr: d.cronExpr || null,
          timezone: d.timezone,
        },
      })
    : await prisma.panelBackup.create({
        data: {
          teamId: team.id,
          name: d.name,
          destType: d.destType,
          destId: d.destType === "local" ? null : d.destId || null,
          destPath: d.destPath || null,
          scheduleType: d.scheduleType,
          timeAt: d.timeAt || null,
          dayOn: d.dayOn ?? null,
          cronExpr: d.cronExpr || null,
          timezone: d.timezone,
        },
      });

  return NextResponse.json({ ok: true, data: { id: backup.id } });
}
