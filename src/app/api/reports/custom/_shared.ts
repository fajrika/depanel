import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveTeam } from "@/lib/team";
import { ITEM_KINDS } from "@/lib/customreport";

const idList = z.array(z.string().min(1)).max(200).optional().default([]);

export const reportSchema = z.object({
  name: z.string().trim().min(1, "Nama laporan wajib diisi").max(120),
  description: z.string().trim().max(1000).optional().nullable().default(null),
  rangeDays: z.coerce.number().int().min(1).max(366).default(7),
  timezone: z.string().min(1).max(64).default("Asia/Jakarta"),
  items: z
    .object(Object.fromEntries(ITEM_KINDS.map((k) => [k, idList])) as Record<(typeof ITEM_KINDS)[number], typeof idList>)
    .default(Object.fromEntries(ITEM_KINDS.map((k) => [k, []])) as never),
});

/** Laporan milik tim aktif user, atau null. */
export async function loadOwnReport(user: { id: string; name: string; lastTeamId?: string | null }, id: string) {
  const team = await getActiveTeam(user);
  const report = await prisma.customReport.findUnique({ where: { id } });
  if (!report || report.teamId !== team.id) return null;
  return { team, report };
}
