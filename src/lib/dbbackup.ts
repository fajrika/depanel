// MySQL backup engine: dump selected databases to .sql.gz, then deliver to
// a destination (local path / FTP / S3). SMB shares are used by mounting them
// to a local path (macOS: Finder → Go → Connect to Server), then "local".
// No mysqldump binary required — pure JS via mysql2.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import mysql, { type Connection } from "mysql2/promise";
import { Client as FtpClient } from "basic-ftp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { CronExpressionParser } from "cron-parser";
import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import { notifyTeam } from "./notify";

export interface ConnCfg {
  host: string;
  port: number;
  username: string;
  password: string;
}

const SYSTEM_DBS = new Set(["information_schema", "performance_schema", "mysql", "sys"]);

async function openConn(cfg: ConnCfg, database?: string): Promise<Connection> {
  return mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.username,
    password: cfg.password,
    database,
    connectTimeout: 10_000,
    // dump raw-ish values; keep types simple for re-INSERT
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}

export async function testConnection(cfg: ConnCfg): Promise<void> {
  const conn = await openConn(cfg);
  try {
    await conn.ping();
  } finally {
    await conn.end();
  }
}

export async function listDatabases(cfg: ConnCfg): Promise<string[]> {
  const conn = await openConn(cfg);
  try {
    const [rows] = await conn.query("SHOW DATABASES");
    return (rows as { Database: string }[]).map((r) => r.Database).filter((d) => !SYSTEM_DBS.has(d));
  } finally {
    await conn.end();
  }
}

/** Dump databases into a gzip'd SQL file inside the OS temp dir; returns the path. */
export async function dumpDatabases(cfg: ConnCfg, databases: string[], fileBase: string): Promise<string> {
  const outPath = path.join(os.tmpdir(), `${fileBase}.sql.gz`);
  const gzip = zlib.createGzip({ level: 6 });
  const out = fs.createWriteStream(outPath);
  const done = pipeline(gzip, out);

  const write = (s: string) =>
    new Promise<void>((resolve, reject) => {
      gzip.write(s, (e) => (e ? reject(e) : resolve()));
    });

  const conn = await openConn(cfg);
  try {
    await write(`-- Depanel MySQL backup\n-- Host: ${cfg.host}\nSET FOREIGN_KEY_CHECKS=0;\nSET NAMES utf8mb4;\n\n`);
    for (const db of databases) {
      const dbId = mysql.escapeId(db);
      await write(`CREATE DATABASE IF NOT EXISTS ${dbId};\nUSE ${dbId};\n\n`);
      await conn.changeUser({ database: db });

      const [tblRows] = await conn.query("SHOW FULL TABLES");
      const all = (tblRows as Record<string, string>[]).map((r) => {
        const vals = Object.values(r);
        return { name: vals[0], type: vals[1] };
      });
      const tables = all.filter((t) => t.type === "BASE TABLE").map((t) => t.name);
      const views = all.filter((t) => t.type === "VIEW").map((t) => t.name);

      for (const table of tables) {
        const tId = mysql.escapeId(table);
        const [createRows] = await conn.query(`SHOW CREATE TABLE ${tId}`);
        const createSql = (createRows as Record<string, string>[])[0]["Create Table"];
        await write(`DROP TABLE IF EXISTS ${tId};\n${createSql};\n\n`);

        // data — chunked to keep memory bounded
        const CHUNK = 1000;
        let offset = 0;
        for (;;) {
          const [rows] = await conn.query(`SELECT * FROM ${tId} LIMIT ${CHUNK} OFFSET ${offset}`);
          const list = rows as Record<string, unknown>[];
          if (list.length === 0) break;
          const cols = Object.keys(list[0]).map((c) => mysql.escapeId(c)).join(",");
          const values = list.map(
            (r) => `(${Object.values(r).map((v) => mysql.escape(v as string | number | boolean | null | Date | Buffer)).join(",")})`,
          );
          // batch INSERTs of 200 rows
          for (let i = 0; i < values.length; i += 200) {
            await write(`INSERT INTO ${tId} (${cols}) VALUES\n${values.slice(i, i + 200).join(",\n")};\n`);
          }
          await write("\n");
          if (list.length < CHUNK) break;
          offset += CHUNK;
        }
      }

      for (const view of views) {
        const vId = mysql.escapeId(view);
        try {
          const [createRows] = await conn.query(`SHOW CREATE VIEW ${vId}`);
          const createSql = (createRows as Record<string, string>[])[0]["Create View"];
          await write(`DROP VIEW IF EXISTS ${vId};\n${createSql};\n\n`);
        } catch {
          await write(`-- gagal dump view ${view}\n`);
        }
      }
    }
    await write("SET FOREIGN_KEY_CHECKS=1;\n");
  } finally {
    await conn.end();
    gzip.end();
  }
  await done;
  return outPath;
}

// ---------- destinations ----------

export type DestConfig = Record<string, string | number | boolean | undefined>;

/** Deliver the dump file; returns a human-readable final location. */
export async function deliver(destType: string, cfg: DestConfig, filePath: string, fileName: string): Promise<string> {
  if (destType === "local") {
    const dir = String(cfg.path || "");
    if (!dir) throw new Error("Path tujuan belum diisi");
    await fsp.mkdir(dir, { recursive: true });
    const target = path.join(dir, fileName);
    await fsp.copyFile(filePath, target);
    return target;
  }

  if (destType === "ftp") {
    const client = new FtpClient(30_000);
    try {
      await client.access({
        host: String(cfg.host || ""),
        port: Number(cfg.port || 21),
        user: String(cfg.username || ""),
        password: cfg.passwordEnc ? decryptSecret(String(cfg.passwordEnc)) : "",
        secure: cfg.secure === true || cfg.secure === "true",
      });
      const dir = String(cfg.path || "/");
      await client.ensureDir(dir);
      await client.uploadFrom(filePath, fileName);
      return `ftp://${cfg.host}${dir.endsWith("/") ? dir : dir + "/"}${fileName}`;
    } finally {
      client.close();
    }
  }

  if (destType === "s3") {
    const s3 = new S3Client({
      region: String(cfg.region || "auto"),
      ...(cfg.endpoint ? { endpoint: String(cfg.endpoint), forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: String(cfg.accessKeyId || ""),
        secretAccessKey: cfg.secretKeyEnc ? decryptSecret(String(cfg.secretKeyEnc)) : "",
      },
    });
    const prefix = String(cfg.prefix || "").replace(/^\/+|\/+$/g, "");
    const key = prefix ? `${prefix}/${fileName}` : fileName;
    await s3.send(
      new PutObjectCommand({
        Bucket: String(cfg.bucket || ""),
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentType: "application/gzip",
      }),
    );
    return `s3://${cfg.bucket}/${key}`;
  }

  throw new Error(`Tujuan backup tidak dikenal: ${destType}`);
}

// ---------- job runner ----------

const runningJobs = new Set<string>();

export async function runJob(jobId: string, trigger: "manual" | "scheduler" = "manual"): Promise<void> {
  if (runningJobs.has(jobId)) return; // sudah berjalan
  runningJobs.add(jobId);

  const job = await prisma.dbBackupJob.findUnique({ where: { id: jobId }, include: { connection: true } });
  if (!job) {
    runningJobs.delete(jobId);
    return;
  }
  const run = await prisma.dbBackupRun.create({ data: { jobId, status: "running", message: `trigger: ${trigger}` } });
  await prisma.dbBackupJob.update({ where: { id: jobId }, data: { lastStatus: "running" } });

  let tmpFile: string | null = null;
  try {
    const cfg: ConnCfg = {
      host: job.connection.host,
      port: job.connection.port,
      username: job.connection.username,
      password: decryptSecret(job.connection.passwordEnc),
    };
    const databases = JSON.parse(job.databases) as string[];
    if (!databases.length) throw new Error("Tidak ada database dipilih");

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileBase = `${job.name.replace(/[^a-zA-Z0-9_-]+/g, "_")}-${stamp}`;
    tmpFile = await dumpDatabases(cfg, databases, fileBase);
    const size = (await fsp.stat(tmpFile)).size;

    const destCfg = JSON.parse(job.destConfig) as DestConfig;
    const location = await deliver(job.destType, destCfg, tmpFile, `${fileBase}.sql.gz`);

    await prisma.dbBackupRun.update({
      where: { id: run.id },
      data: { status: "success", sizeBytes: size, location, endedAt: new Date(), message: `${databases.length} database` },
    });
    await prisma.dbBackupJob.update({ where: { id: jobId }, data: { lastStatus: "success", lastRunAt: new Date() } });
    if (trigger === "scheduler") {
      await notifyTeam(job.connection.teamId, "backup", `💾 Backup DB "${job.name}" sukses (${databases.length} database).`);
    }
  } catch (e) {
    const msg = (e as Error).message;
    await prisma.dbBackupRun.update({
      where: { id: run.id },
      data: { status: "failed", message: msg, endedAt: new Date() },
    });
    await prisma.dbBackupJob.update({ where: { id: jobId }, data: { lastStatus: "failed", lastRunAt: new Date() } });
    await notifyTeam(job.connection.teamId, "backup", `❌ Backup DB "${job.name}" GAGAL: ${msg}`);
  } finally {
    if (tmpFile) await fsp.rm(tmpFile, { force: true }).catch(() => {});
    runningJobs.delete(jobId);
  }
}

// ---------- restore ----------

/**
 * Restore a completed run's dump back into its connection's MySQL server.
 * Only supported for the "local" destination (file readable on disk). The dump
 * carries CREATE DATABASE/USE, so it restores into the original database names.
 */
export async function restoreRun(runId: string): Promise<{ ok: boolean; message: string }> {
  const run = await prisma.dbBackupRun.findUnique({
    where: { id: runId },
    include: { job: { include: { connection: true } } },
  });
  if (!run) return { ok: false, message: "Run tidak ditemukan" };
  if (run.status !== "success" || !run.location) return { ok: false, message: "Run ini tidak punya arsip yang valid" };
  if (run.job.destType !== "local") {
    return { ok: false, message: "Restore otomatis hanya untuk tujuan Lokal. Untuk FTP/S3, unduh arsip lalu restore manual." };
  }

  const file = run.location;
  try {
    await fsp.access(file);
  } catch {
    return { ok: false, message: "File arsip tidak ditemukan di path lokal" };
  }

  const cfg: ConnCfg = {
    host: run.job.connection.host,
    port: run.job.connection.port,
    username: run.job.connection.username,
    password: decryptSecret(run.job.connection.passwordEnc),
  };

  // stream-gunzip the dump into a string, then execute (allowing multi statements)
  const gunzip = zlib.createGunzip();
  const chunks: Buffer[] = [];
  await pipeline(fs.createReadStream(file), gunzip, async function* (source) {
    for await (const c of source) chunks.push(c as Buffer);
    yield; // satisfy pipeline sink
  });
  const sql = Buffer.concat(chunks).toString("utf8");

  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.username,
    password: cfg.password,
    multipleStatements: true,
    connectTimeout: 15_000,
  });
  try {
    await conn.query(sql);
    return { ok: true, message: "Restore selesai" };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  } finally {
    await conn.end();
  }
}

/** Delete a run row and, for local destinations, its file. */
export async function deleteRun(runId: string): Promise<void> {
  const run = await prisma.dbBackupRun.findUnique({ where: { id: runId }, include: { job: true } });
  if (!run) return;
  if (run.job.destType === "local" && run.location) {
    await fsp.rm(run.location, { force: true }).catch(() => {});
  }
  await prisma.dbBackupRun.delete({ where: { id: runId } }).catch(() => {});
}

// ---------- schedule matching (dipanggil worker tiap menit) ----------

function localStamp(now: Date, tz: string): { weekday: number; date: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: dayMap[get("weekday")] ?? 0,
    date: parseInt(get("day"), 10),
    hhmm: `${get("hour").padStart(2, "0")}:${get("minute")}`.replace(/^24/, "00"),
  };
}

export function jobIsDue(
  job: { scheduleType: string; timeAt: string | null; dayOn: number | null; cronExpr: string | null; timezone: string },
  now: Date,
): boolean {
  const { weekday, date, hhmm } = localStamp(now, job.timezone);
  switch (job.scheduleType) {
    case "daily":
      return job.timeAt === hhmm;
    case "weekly":
      return job.dayOn === weekday && job.timeAt === hhmm;
    case "monthly":
      return job.dayOn === date && job.timeAt === hhmm;
    case "cron": {
      if (!job.cronExpr) return false;
      try {
        const it = CronExpressionParser.parse(job.cronExpr, { currentDate: now, tz: job.timezone });
        const prev = it.prev().toDate();
        return now.getTime() - prev.getTime() < 60_000;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/** Jalankan semua job yang jatuh tempo menit ini. */
export async function runDueJobs(now: Date = new Date()): Promise<string[]> {
  const jobs = await prisma.dbBackupJob.findMany({ where: { enabled: true } });
  const started: string[] = [];
  for (const j of jobs) {
    if (jobIsDue(j, now)) {
      started.push(j.name);
      void runJob(j.id, "scheduler");
    }
  }
  return started;
}
