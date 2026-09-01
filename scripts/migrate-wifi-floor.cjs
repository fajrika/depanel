// Migrasi sekali-jalan: tambah dukungan multi-lantai.
// - Membuat tabel WifiFloor + satu lantai default per proyek (level 1, CONCRETE,
//   floorplanData dipindah dari WifiProject).
// - WifiWall & WifiAccessPoint diberi kolom floorId (diisi lantai default).
// - WifiProject dibentuk ulang tanpa kolom floorplanData.
// Dijalankan SEBELUM deploy versi baru (prisma db push entrypoint jadi no-op).
//
// Pemakaian: node scripts/migrate-wifi-floor.cjs [path-ke-sqlite]
const { DatabaseSync } = require("node:sqlite");

const path = process.argv[2] || "/app/data/depanel.db";
const db = new DatabaseSync(path);

const has = db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?").get("table", "WifiFloor");
if (has) {
  console.log("WifiFloor sudah ada — migrasi di-skip.");
  db.close();
  process.exit(0);
}

db.exec("PRAGMA foreign_keys = OFF");

db.exec(`
CREATE TABLE "WifiFloor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Lantai 1',
    "level" INTEGER NOT NULL DEFAULT 1,
    "heightM" REAL NOT NULL DEFAULT 3,
    "material" TEXT NOT NULL DEFAULT 'CONCRETE',
    "floorplanData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WifiFloor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WifiProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WifiFloor_projectId_idx" ON "WifiFloor"("projectId");

INSERT INTO "WifiFloor" ("id","projectId","name","level","heightM","material","floorplanData","createdAt","updatedAt")
SELECT 'floor_' || lower(hex(randomblob(8))), "id", 'Lantai 1', 1, 3.0, 'CONCRETE', "floorplanData", "createdAt", "updatedAt"
FROM "WifiProject";

CREATE TABLE "_wifi_wall_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "x1" REAL NOT NULL,
    "y1" REAL NOT NULL,
    "x2" REAL NOT NULL,
    "y2" REAL NOT NULL,
    "material" TEXT NOT NULL DEFAULT 'DRYWALL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WifiWall_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WifiProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WifiWall_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "WifiFloor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "_wifi_wall_new" ("id","projectId","floorId","x1","y1","x2","y2","material","createdAt")
SELECT w."id", w."projectId", f."id", w."x1", w."y1", w."x2", w."y2", w."material", w."createdAt"
FROM "WifiWall" w JOIN "WifiFloor" f ON f."projectId" = w."projectId";
DROP TABLE "WifiWall";
ALTER TABLE "_wifi_wall_new" RENAME TO "WifiWall";
CREATE INDEX "WifiWall_projectId_idx" ON "WifiWall"("projectId");
CREATE INDEX "WifiWall_floorId_idx" ON "WifiWall"("floorId");

CREATE TABLE "_wifi_ap_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ssid" TEXT,
    "heightM" REAL NOT NULL DEFAULT 2.5,
    "posX" REAL NOT NULL,
    "posY" REAL NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WifiAccessPoint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WifiProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WifiAccessPoint_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "WifiFloor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "_wifi_ap_new" ("id","projectId","floorId","name","ssid","heightM","posX","posY","enabled","createdAt","updatedAt")
SELECT a."id", a."projectId", f."id", a."name", a."ssid", a."heightM", a."posX", a."posY", a."enabled", a."createdAt", a."updatedAt"
FROM "WifiAccessPoint" a JOIN "WifiFloor" f ON f."projectId" = a."projectId";
DROP TABLE "WifiAccessPoint";
ALTER TABLE "_wifi_ap_new" RENAME TO "WifiAccessPoint";
CREATE INDEX "WifiAccessPoint_projectId_idx" ON "WifiAccessPoint"("projectId");
CREATE INDEX "WifiAccessPoint_floorId_idx" ON "WifiAccessPoint"("floorId");

CREATE TABLE "_wifi_project_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "widthM" REAL NOT NULL DEFAULT 20,
    "heightM" REAL NOT NULL DEFAULT 15,
    "scalePxPerM" REAL NOT NULL DEFAULT 20,
    "bgColor" TEXT NOT NULL DEFAULT '#f8fafc',
    "pathLossExponent" REAL NOT NULL DEFAULT 3.0,
    "deadZoneDbm" REAL NOT NULL DEFAULT -70,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WifiProject_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "_wifi_project_new" ("id","teamId","name","description","widthM","heightM","scalePxPerM","bgColor","pathLossExponent","deadZoneDbm","createdAt","updatedAt")
SELECT "id","teamId","name","description","widthM","heightM","scalePxPerM","bgColor","pathLossExponent","deadZoneDbm","createdAt","updatedAt"
FROM "WifiProject";
DROP TABLE "WifiProject";
ALTER TABLE "_wifi_project_new" RENAME TO "WifiProject";
CREATE INDEX "WifiProject_teamId_idx" ON "WifiProject"("teamId");
`);

db.exec("PRAGMA foreign_keys = ON");

const floorCount = db.prepare("SELECT COUNT(*) AS c FROM WifiFloor").get().c;
const projectCount = db.prepare("SELECT COUNT(*) AS c FROM WifiProject").get().c;
const wallCount = db.prepare("SELECT COUNT(*) AS c FROM WifiWall").get().c;
const apCount = db.prepare("SELECT COUNT(*) AS c FROM WifiAccessPoint").get().c;
const missingFloor = db.prepare("SELECT COUNT(*) AS c FROM WifiWall WHERE floorId IS NULL OR floorId = ''").get().c;
const missingApFloor = db.prepare("SELECT COUNT(*) AS c FROM WifiAccessPoint WHERE floorId IS NULL OR floorId = ''").get().c;
console.log(`Migrasi selesai — ${projectCount} proyek, ${floorCount} lantai, ${wallCount} dinding (tanpa floor: ${missingFloor}), ${apCount} AP (tanpa floor: ${missingApFloor}).`);
db.close();