// Migrasi satu kali: pindahkan folder tujuan dari destConfig ke destPath per job.
// Karena kolom destConfig di-drop oleh db push, data lama dibaca dari backup
// /tmp/dest-configs.json (dibuat sebelum db push). Jalankan: npx tsx scripts/migrate-dest.ts
process.loadEnvFile(".env");
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const rows = JSON.parse(readFileSync("/tmp/dest-configs.json", "utf8")) as Array<{
  id: string;
  name: string;
  destType: string;
  destConfig: string;
}>;

async function main() {
  let moved = 0;
  for (const row of rows) {
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(row.destConfig);
    } catch {
      cfg = {};
    }
    if (row.destType === "local" && typeof cfg.path === "string" && cfg.path) {
      await prisma.dbBackupJob.update({
        where: { id: row.id },
        data: { destPath: cfg.path },
      });
      moved++;
      console.log(`✅ ${row.name} → destPath = "${cfg.path}"`);
    } else {
      console.log(`⚠️  ${row.name} (${row.destType}) tidak punya path lokal — destPath dikosongkan`);
    }
  }
  console.log(`Selesai: ${moved}/${rows.length} job dimigrasi ke destPath.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
