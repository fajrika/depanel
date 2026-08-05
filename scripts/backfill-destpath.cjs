// Boot-time backfill: copy the target folder/path from the (to-be-dropped)
// destConfig column into DbBackupJob.destPath so job destinations survive the
// schema change. Must run BEFORE `prisma db push --accept-data-loss` drops the
// column. Uses raw SQL because the generated Prisma client no longer knows
// destConfig after the schema refactor.
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, name, destType, destConfig FROM "DbBackupJob" WHERE destConfig IS NOT NULL`
  );
  let moved = 0;
  for (const row of rows) {
    let cfg = {};
    try {
      cfg = JSON.parse(row.destConfig);
    } catch {}
    let destPath = null;
    if (row.destType === "local" && typeof cfg.path === "string" && cfg.path) {
      destPath = cfg.path;
    } else if (row.destType === "ftp" && typeof cfg.path === "string" && cfg.path) {
      destPath = cfg.path;
    } else if (row.destType === "s3" && typeof cfg.prefix === "string" && cfg.prefix) {
      destPath = cfg.prefix;
    } else if (row.destType === "gdrive" && typeof cfg.folderId === "string" && cfg.folderId) {
      destPath = cfg.folderId;
    }
    await prisma.$executeRawUnsafe(
      `UPDATE "DbBackupJob" SET destPath = ? WHERE id = ?`,
      destPath,
      row.id
    );
    moved++;
    console.log(`→ ${row.name ?? row.id}: destPath=${destPath ?? "(kosong)"}`);
  }
  console.log(`Backfill destPath: ${moved} job diperbarui.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
