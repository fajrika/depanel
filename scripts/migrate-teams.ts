// Migrasi satu kali ke model workspace:
// - setiap user dapat tim pribadi (isPersonal) + membership owner
// - akun depa & koneksi DB yang belum punya tim → tim pribadi admin pertama
// - tim lama non-pribadi: pastikan tiap member punya role (admin pertama jadi owner)
// Jalankan: npx tsx scripts/migrate-teams.ts
process.loadEnvFile(".env");
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  // 1) tim pribadi per user
  for (const u of users) {
    const existing = await prisma.team.findFirst({
      where: { isPersonal: true, members: { some: { userId: u.id } } },
    });
    if (existing) continue;
    await prisma.team.create({
      data: {
        name: `Pribadi — ${u.name}`,
        isPersonal: true,
        members: { create: { userId: u.id, role: "owner", canViewBilling: true } },
      },
    });
    console.log(`✅ Tim pribadi dibuat untuk ${u.email}`);
  }

  // 2) backfill data tanpa tim → tim pribadi admin pertama (fallback: user pertama)
  const anchor = users.find((u) => u.role === "admin") ?? users[0];
  if (anchor) {
    const personal = await prisma.team.findFirst({
      where: { isPersonal: true, members: { some: { userId: anchor.id } } },
    });
    if (personal) {
      const a = await prisma.depaAccount.updateMany({ where: { teamId: null }, data: { teamId: personal.id } });
      const c = await prisma.dbConnection.updateMany({ where: { teamId: null }, data: { teamId: personal.id } });
      if (a.count || c.count) {
        console.log(`✅ ${a.count} akun depa & ${c.count} koneksi DB dipindah ke "${personal.name}"`);
      }
    }
  }

  // 3) tim lama non-pribadi: pastikan ada owner
  const shared = await prisma.team.findMany({ where: { isPersonal: false }, include: { members: true } });
  for (const t of shared) {
    if (t.members.length === 0) continue;
    if (!t.members.some((m) => m.role === "owner")) {
      const promote = t.members.find((m) => m.userId === anchor?.id) ?? t.members[0];
      await prisma.teamMember.update({
        where: { id: promote.id },
        data: { role: "owner", canViewBilling: true },
      });
      console.log(`✅ Owner ditetapkan untuk tim "${t.name}"`);
    }
  }

  console.log("Migrasi selesai.");
}

main().finally(() => prisma.$disconnect());
