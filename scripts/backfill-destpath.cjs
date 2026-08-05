// Boot-time backfill for the destConfig → destPath refactor. Two phases because
// the two columns never coexist in the database:
//   --save  : reads destConfig (OLD schema) and caches {id, destPath} to a file.
//             Must run BEFORE `prisma db push --accept-data-loss` drops destConfig.
//   --apply : after db push adds destPath (NEW schema), writes cached values back.
//             Must run AFTER db push.
// Both phases are idempotent and tolerate the column being absent (fresh DB or an
// already-migrated DB just skips). Uses raw SQL so it works with either schema.
const { PrismaClient } = require("@prisma/client");
const fs = require("node:fs");

const CACHE = process.env.BACKFILL_CACHE || "/app/data/backfill-destpath.json";

async function columnExists(prisma, table, column) {
  const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
  return cols.some((c) => c.name === column);
}

function destPathFrom(row) {
  let cfg = {};
  try {
    cfg = JSON.parse(row.destConfig);
  } catch {}
  if (row.destType === "local" && typeof cfg.path === "string" && cfg.path) return cfg.path;
  if (row.destType === "ftp" && typeof cfg.path === "string" && cfg.path) return cfg.path;
  if (row.destType === "s3" && typeof cfg.prefix === "string" && cfg.prefix) return cfg.prefix;
  if (row.destType === "gdrive" && typeof cfg.folderId === "string" && cfg.folderId) return cfg.folderId;
  return null;
}

async function save() {
  const prisma = new PrismaClient();
  try {
    if (!(await columnExists(prisma, "DbBackupJob", "destConfig"))) {
      console.log("→ Backfill: kolom destConfig tidak ada — lewati (schema sudah baru).");
      return;
    }
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, name, destType, destConfig FROM "DbBackupJob" WHERE destConfig IS NOT NULL`
    );
    const data = rows.map((row) => ({ id: row.id, destPath: destPathFrom(row) }));
    fs.writeFileSync(CACHE, JSON.stringify(data));
    console.log(`→ Backfill tersimpan: ${data.length} job ke cache (${CACHE}).`);
  } finally {
    await prisma.$disconnect();
  }
}

async function apply() {
  if (!fs.existsSync(CACHE)) {
    console.log("→ Backfill: tidak ada cache — lewati.");
    return;
  }
  const prisma = new PrismaClient();
  try {
    const data = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    let moved = 0;
    for (const row of data) {
      await prisma.$executeRawUnsafe(
        `UPDATE "DbBackupJob" SET destPath = ? WHERE id = ?`,
        row.destPath,
        row.id
      );
      moved++;
      console.log(`→ ${row.id}: destPath=${row.destPath ?? "(kosong)"}`);
    }
    fs.rmSync(CACHE, { force: true });
    console.log(`→ Backfill diterapkan: ${moved} job.`);
  } finally {
    await prisma.$disconnect();
  }
}

const phase = process.argv[2];
if (phase === "--save") {
  save().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (phase === "--apply") {
  apply().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.error("usage: node backfill-destpath.cjs --save|--apply");
  process.exit(2);
}
