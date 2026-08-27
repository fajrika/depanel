// Migrasi sekali-jalan: WifiAccessPoint (1 AP = 1 band) → WifiApRadio (1 AP = banyak band).
// Menciptakan tabel WifiApRadio + menyalin setting band tiap AP menjadi satu radio,
// lalu membentuk ulang WifiAccessPoint tanpa kolom band. Dipakai sebelum deploy
// versi baru (prisma db push pada entrypoint jadi no-op).
//
// Pemakaian: node scripts/migrate-wifi-radio.cjs [path-ke-sqlite]
const { DatabaseSync } = require("node:sqlite");

const path = process.argv[2] || "/app/data/depanel.db";
const db = new DatabaseSync(path);

const has = db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?").get("table", "WifiApRadio");
if (has) {
  console.log("WifiApRadio sudah ada — migrasi di-skip.");
  db.close();
  process.exit(0);
}

db.exec("PRAGMA foreign_keys = OFF");

db.exec(`
CREATE TABLE "WifiApRadio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "apId" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "channel" INTEGER NOT NULL DEFAULT 1,
    "channelWidth" INTEGER NOT NULL DEFAULT 20,
    "txPowerDbm" REAL NOT NULL DEFAULT 20,
    "antennaGainDbi" REAL NOT NULL DEFAULT 3,
    "antennaType" TEXT NOT NULL DEFAULT 'OMNIDIRECTIONAL',
    "azimuthDeg" INTEGER DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WifiApRadio_apId_fkey" FOREIGN KEY ("apId") REFERENCES "WifiAccessPoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WifiApRadio_apId_idx" ON "WifiApRadio"("apId");

INSERT INTO "WifiApRadio" ("id","apId","band","channel","channelWidth","txPowerDbm","antennaGainDbi","antennaType","azimuthDeg","enabled","createdAt","updatedAt")
SELECT 'radio_' || lower(hex(randomblob(8))), "id", "band", "channel", "channelWidth", "txPowerDbm", "antennaGainDbi", "antennaType", "azimuthDeg", "enabled", "createdAt", "updatedAt"
FROM "WifiAccessPoint";

CREATE TABLE "_wifi_ap_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ssid" TEXT,
    "heightM" REAL NOT NULL DEFAULT 2.5,
    "posX" REAL NOT NULL,
    "posY" REAL NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WifiAccessPoint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "WifiProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "_wifi_ap_new" ("id","projectId","name","ssid","heightM","posX","posY","enabled","createdAt","updatedAt")
SELECT "id","projectId","name","ssid","heightM","posX","posY","enabled","createdAt","updatedAt" FROM "WifiAccessPoint";
DROP TABLE "WifiAccessPoint";
ALTER TABLE "_wifi_ap_new" RENAME TO "WifiAccessPoint";
CREATE INDEX "WifiAccessPoint_projectId_idx" ON "WifiAccessPoint"("projectId");
`);

db.exec("PRAGMA foreign_keys = ON");

const apCount = db.prepare("SELECT COUNT(*) AS c FROM WifiAccessPoint").get().c;
const radioCount = db.prepare("SELECT COUNT(*) AS c FROM WifiApRadio").get().c;
console.log(`Migrasi selesai — ${apCount} AP, ${radioCount} radio.`);
db.close();