// One-time backfill after the per-feature permission split. Previously the single
// "saldo" flag (canViewBilling) granted Saldo, Biaya, AND Laporan. Now those are
// separate flags, so preserve legacy access: any member with canViewBilling=true
// also gets canViewCost + canViewReports. Idempotent — safe to run on every boot.
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const res = await prisma.teamMember.updateMany({
      where: {
        role: "member",
        canViewBilling: true,
        OR: [{ canViewCost: false }, { canViewReports: false }],
      },
      data: { canViewCost: true, canViewReports: true },
    });
    if (res.count === 0) {
      console.log("→ Backfill izin: tidak ada yang perlu diubah.");
    } else {
      console.log(`→ Backfill izin: ${res.count} member dapat biaya+laporan (warisan izin saldo).`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
