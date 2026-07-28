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
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { CronExpressionParser } from "cron-parser";
import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import { notifyTeam } from "./notify";
import { getGDriveOAuthToken, gdriveOAuthUpload, gdriveOAuthDownload } from "./gdrive-oauth";

// ---------- SQL statement splitter ----------

/**
 * Split a SQL dump into individual statements, handling:
 * - Single-quoted string literals (including escaped quotes '')
 * - Double-quoted identifiers
 * - Backslash escapes inside strings
 * - Line comments (-- ...)
 * - Block comments (/* ... *​/)
 * - Proper semicolon splitting only outside all the above contexts
 *
 * Based on the resilient parser from BackupDB-GO (gorestore.go).
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\" && (inSingleQuote || inDoubleQuote)) {
      current += ch;
      escaped = true;
      continue;
    }

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        current += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && i + 1 < sql.length && sql[i + 1] === "/") {
        inBlockComment = false;
        current += "*/";
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      current += ch;
      if (ch === "'") {
        // Check for escaped quote ('')
        if (i + 1 < sql.length && sql[i + 1] === "'") {
          current += "'";
          i++;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }

    if (inDoubleQuote) {
      current += ch;
      if (ch === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    // Outside string literals
    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      current += ch;
      continue;
    }

    // Comment
    if (ch === "-" && i + 1 < sql.length && sql[i + 1] === "-") {
      inLineComment = true;
      current += "--";
      i++;
      continue;
    }
    if (ch === "/" && i + 1 < sql.length && sql[i + 1] === "*") {
      inBlockComment = true;
      current += "/*";
      i++;
      continue;
    }

    // Statement separator
    if (ch === ";") {
      const s = current.trim();
      if (s !== "") {
        statements.push(s);
      }
      current = "";
      continue;
    }

    current += ch;
  }

  // Remaining text
  const s = current.trim();
  if (s !== "") {
    statements.push(s);
  }

  return statements;
}

/**
 * Split a large INSERT INTO ... VALUES statement into smaller chunks.
 * This prevents max_allowed_packet errors and timeouts on huge inserts.
 * Only splits multi-row INSERTs; single-row or non-INSERT statements pass through.
 */
function splitLargeInserts(statements: string[], maxBytes = 50_000): string[] {
  const result: string[] = [];
  for (const stmt of statements) {
    if (stmt.length <= maxBytes || !/^\s*INSERT\s+INTO\s/i.test(stmt)) {
      result.push(stmt);
      continue;
    }
    // Extract: INSERT INTO `table` (`col1`,...) VALUES
    const m = stmt.match(/^(\s*INSERT\s+INTO\s+[`"']?\w+[`"']?\s*\([^)]+\)\s*VALUES\s*)([\s\S]+)$/i);
    if (!m) {
      result.push(stmt);
      continue;
    }
    const prefix = m[1];
    const valuesStr = m[2];

    // Parse individual value tuples, respecting quotes
    const tuples: string[] = [];
    let depth = 0;
    let inSq = false;
    let inDq = false;
    let esc = false;
    let start = 0;
    for (let i = 0; i < valuesStr.length; i++) {
      const ch = valuesStr[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\" && (inSq || inDq)) { esc = true; continue; }
      if (inSq) { if (ch === "'") { if (valuesStr[i + 1] === "'") { i++; } else inSq = false; } continue; }
      if (inDq) { if (ch === '"') inDq = false; continue; }
      if (ch === "'") { inSq = true; continue; }
      if (ch === '"') { inDq = true; continue; }
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        tuples.push(valuesStr.substring(start, i).trim());
        start = i + 1;
      }
    }
    const last = valuesStr.substring(start).trim();
    if (last) tuples.push(last);

    if (tuples.length <= 1) {
      result.push(stmt);
      continue;
    }

    // Reassemble into chunks under maxBytes
    let chunk: string[] = [];
    let chunkSize = prefix.length;
    for (const t of tuples) {
      const addSize = t.length + 2; // +2 for ", "
      if (chunk.length > 0 && chunkSize + addSize > maxBytes) {
        result.push(`${prefix}${chunk.join(", ")};`);
        chunk = [];
        chunkSize = prefix.length;
      }
      chunk.push(t);
      chunkSize += addSize;
    }
    if (chunk.length > 0) {
      result.push(`${prefix}${chunk.join(", ")};`);
    }
  }
  return result;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "...";
}

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
    await write(`-- Depanel MySQL backup\n-- Host: ${cfg.host}\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n\n`);
    // Create ALL databases upfront — views in one database may reference
    // tables in another, so all databases must exist before any data is restored.
    for (const db of databases) {
      await write(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(db)};\n`);
    }
    await write("\n");
    // Collect view definitions per-database, but write them AFTER all tables
    // are loaded. Views in one DB may reference tables in another, so the base
    // tables must exist before any view is created.
    const viewsByDb: { db: string; name: string; createSql: string }[] = [];

    for (const db of databases) {
      const dbId = mysql.escapeId(db);
      await write(`USE ${dbId};\n\n`);
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
        let createSql = (createRows as Record<string, string>[])[0]["Create Table"];
        // MySQL 8.0.17+ disallows certain functions (md5, sha1, …) in generated
        // column expressions. Strip `GENERATED ALWAYS AS (...) VIRTUAL|STORED`
        // so the column becomes a regular column — data is still in INSERTs.
        createSql = createSql.replace(/GENERATED ALWAYS AS \(.*\)\s*(VIRTUAL|STORED)/g, "");
        await write(`DROP TABLE IF EXISTS ${tId};\n${createSql};\n\n`);

        // data — chunked to keep memory bounded
        const CHUNK = 1000;
        let offset = 0;
        for (;;) {
          const [rows] = await conn.query(`SELECT * FROM ${tId} LIMIT ${CHUNK} OFFSET ${offset}`);
          const list = rows as Record<string, unknown>[];
          if (list.length === 0) break;
          const colNames = Object.keys(list[0]);
          const cols = colNames.map((c) => mysql.escapeId(c)).join(",");
          const values = list.map(
            (r) => `(${colNames.map((c) => {
              const v = r[c];
              if (v !== null && typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v)) {
                return mysql.escape(JSON.stringify(v));
              }
              return mysql.escape(v as string | number | boolean | null | Date | Buffer);
            }).join(",")})`,
          );
          for (let i = 0; i < values.length; i += 200) {
            await write(`INSERT INTO ${tId} (${cols}) VALUES\n${values.slice(i, i + 200).join(",\n")};\n`);
          }
          await write("\n");
          if (list.length < CHUNK) break;
          offset += CHUNK;
        }
      }

      // Collect views, don't write them yet
      for (const view of views) {
        try {
          const vId = mysql.escapeId(view);
          const [createRows] = await conn.query(`SHOW CREATE VIEW ${vId}`);
          const createSql = (createRows as Record<string, string>[])[0]["Create View"];
          viewsByDb.push({ db, name: view, createSql });
        } catch {
          await write(`-- gagal dump view ${db}.${view}\n`);
        }
      }
    }

    // Write all views AFTER all tables across all databases are loaded
    if (viewsByDb.length > 0) {
      await write("-- Views (created after all tables to resolve cross-database references)\n");
      let lastDb = "";
      for (const v of viewsByDb) {
        if (v.db !== lastDb) {
          await write(`USE ${mysql.escapeId(v.db)};\n`);
          lastDb = v.db;
        }
        const vId = mysql.escapeId(v.name);
        await write(`DROP VIEW IF EXISTS ${vId};\n${v.createSql};\n\n`);
      }
    }
    await write("SET FOREIGN_KEY_CHECKS=1;\nSET UNIQUE_CHECKS=1;\n");
  } finally {
    await conn.end();
    gzip.end();
  }
  await done;
  return outPath;
}

// ---------- retry helper ----------

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delayMs * 2 ** i));
    }
  }
  throw new Error("unreachable");
}

// gdrive-oauth.ts handles OAuth2 token management

// ---------- destinations ----------

export type DestConfig = Record<string, string | number | boolean | undefined>;

/** Deliver the dump file; returns a human-readable final location. */
export async function deliver(destType: string, cfg: DestConfig, filePath: string, fileName: string, jobId?: string): Promise<string> {
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

  if (destType === "gdrive") {
    if (!jobId) throw new Error("jobId wajib untuk Google Drive backup");
    const token = await getGDriveOAuthToken(jobId);
    const folderId = String(cfg.folderId || "");
    if (!folderId) throw new Error("Folder ID wajib diisi untuk Google Drive");
    const fileBytes = await fsp.readFile(filePath);
    const fileId = await withRetry(() => gdriveOAuthUpload(token, folderId, fileName, fileBytes));
    return `gdrive://${fileId}`;
  }

  throw new Error(`Tujuan backup tidak dikenal: ${destType}`);
}

/**
 * Fetch a backup file from any destination (local / FTP / S3) to a local temp path.
 * The caller is responsible for cleaning up the returned file.
 */
export async function fetchBackup(destType: string, cfg: DestConfig, location: string, jobId?: string): Promise<string> {
  if (destType === "local") {
    try {
      await fsp.access(location);
    } catch {
      throw new Error(`File backup lokal tidak ditemukan: ${location}. Pastikan file masih ada di path tersebut.`);
    }
    return location;
  }

  const tmpFile = path.join(os.tmpdir(), `restore-${Date.now()}-${Math.random().toString(36).slice(2)}.sql.gz`);

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
      // location format: ftp://host/path/file.sql.gz
      const url = new URL(location);
      await client.downloadTo(tmpFile, decodeURIComponent(url.pathname));
      return tmpFile;
    } catch (e) {
      throw new Error(`FTP gagal mengambil file: ${(e as Error).message}. Pastikan host, port, username, password FTP benar dan file tersedia.`);
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
    // location format: s3://bucket/key
    const url = new URL(location);
    const bucket = url.host;
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    try {
      const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = await resp.Body!.transformToByteArray();
      await fsp.writeFile(tmpFile, body);
      return tmpFile;
    } catch (e) {
      throw new Error(`S3 gagal mengambil file dari bucket "${bucket}" key "${key}": ${(e as Error).message}. Pastikan credentials S3 benar dan file tersedia.`);
    }
  }

  if (destType === "gdrive") {
    if (!jobId) throw new Error("jobId wajib untuk Google Drive restore");
    try {
      const token = await getGDriveOAuthToken(jobId);
      const fileId = location.replace(/^gdrive:\/\//, "");
      await withRetry(() => gdriveOAuthDownload(token, fileId, tmpFile));
      return tmpFile;
    } catch (e) {
      throw new Error(`Google Drive gagal mengambil file: ${(e as Error).message}. Coba login Google lagi jika token sudah expired.`);
    }
  }

  throw new Error(`Tidak bisa mengambil file dari tujuan: ${destType}`);
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
    if (!databases.length) throw new Error("Tidak ada database yang dipilih");

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileBase = `${job.name.replace(/[^a-zA-Z0-9_-]+/g, "_")}-${stamp}`;
    tmpFile = await dumpDatabases(cfg, databases, fileBase);
    const size = (await fsp.stat(tmpFile)).size;

    const destCfg = JSON.parse(job.destConfig) as DestConfig;
    const location = await deliver(job.destType, destCfg, tmpFile, `${fileBase}.sql.gz`, job.id);

    await prisma.dbBackupRun.update({
      where: { id: run.id },
      data: { status: "success", sizeBytes: size, location, endedAt: new Date(), message: `${databases.length} database` },
    });
    await prisma.dbBackupJob.update({ where: { id: jobId }, data: { lastStatus: "success", lastRunAt: new Date() } });

    // Clean up old backups based on retention policy
    await cleanupRetention(jobId);

    if (trigger === "scheduler") {
      await notifyTeam(job.connection.teamId, "backup", `💾 Backup DB "${job.name}" sukses (${databases.length} database).`);
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const msg = err.message;
    const detail = err.stack ? `\nStack: ${err.stack}` : "";
    console.error(`[BACKUP] Job "${job.name}" failed: ${msg}${detail}`);
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
 *
 * Uses resilient per-statement execution: individual statement failures are
 * logged as warnings but do NOT abort the entire restore. This ensures that
 * the restore completes even if some statements fail (e.g., due to data
 * conflicts, missing dependencies, or partial corruption).
 */
export async function restoreRun(runId: string, targetConnId?: string, restoreId?: string): Promise<{ ok: boolean; message: string; warnings?: string[] }> {
  const run = await prisma.dbBackupRun.findUnique({
    where: { id: runId },
    include: { job: { include: { connection: true } } },
  });
  if (!run) return { ok: false, message: "Run tidak ditemukan" };
  if (run.status !== "success" || !run.location) return { ok: false, message: "Run ini tidak punya arsip yang valid" };

  let connRow;
  if (targetConnId) {
    connRow = await prisma.dbConnection.findUnique({ where: { id: targetConnId } });
    if (!connRow) return { ok: false, message: "Koneksi tujuan tidak ditemukan" };
  } else {
    connRow = run.job.connection;
  }

  const cfg: ConnCfg = {
    host: connRow.host,
    port: connRow.port,
    username: connRow.username,
    password: decryptSecret(connRow.passwordEnc),
  };

  // Fetch the backup file (local path, or download from FTP/S3)
  const destCfg = JSON.parse(run.job.destConfig) as DestConfig;
  let tmpFile: string | null = null;
  let file: string;
  try {
    file = await fetchBackup(run.job.destType, destCfg, run.location, run.job.id);
    if (file !== run.location) tmpFile = file;
  } catch (e) {
    const detail = (e as Error).message;
    return { ok: false, message: `Gagal mengambil arsip backup dari ${run.job.destType.toUpperCase()}: ${detail}. Pastikan file backup masih tersedia dan koneksi ke storage aktif.` };
  }

  // Stream-gunzip the dump into a string
  let sql: string;
  try {
    const gunzip = zlib.createGunzip();
    const chunks: Buffer[] = [];
    const t0 = Date.now();
    await pipeline(fs.createReadStream(file), gunzip, async function* (source) {
      for await (const c of source) chunks.push(c as Buffer);
      yield; // satisfy pipeline sink
    });
    sql = Buffer.concat(chunks).toString("utf8");
    console.log(`[RESTORE] Decompress selesai dalam ${((Date.now() - t0) / 1000).toFixed(1)}s — ${(sql.length / 1024 / 1024).toFixed(2)} MB`);
  } catch (e) {
    const detail = (e as Error).message;
    return { ok: false, message: `Gagal membaca file backup (decompress): ${detail}. File mungkin korup atau bukan file .sql.gz yang valid.` };
  }

  // Split into individual statements for resilient execution
  let statements = splitStatements(sql);
  if (statements.length === 0) {
    return { ok: false, message: "File backup kosong atau tidak mengandung SQL yang valid. Periksa apakah file backup benar-benar hasil dump MySQL." };
  }

  // Split large INSERT statements to avoid max_allowed_packet issues
  const beforeCount = statements.length;
  statements = splitLargeInserts(statements, 50_000);
  console.log(`[RESTORE] Split: ${beforeCount} → ${statements.length} statements (terbesar: ${Math.max(...statements.map(s => s.length))} bytes)`);

  const warnings: string[] = [];
  let warningCount = 0;

  let conn;
  try {
    conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.username,
      password: cfg.password,
      connectTimeout: 15_000,
    });
  } catch (e) {
    const detail = (e as Error).message;
    return { ok: false, message: `Gagal koneksi ke MySQL ${cfg.host}:${cfg.port} (user: ${cfg.username}): ${detail}. Periksa host, port, username, password, dan pastikan MySQL server aktif dan bisa diakses dari server ini.` };
  }

  try {
    // Phase 1: Disable FK checks and pre-create ALL databases first.
    // This ensures cross-database foreign keys won't fail because the
    // referenced database doesn't exist yet when the referencing table
    // is being restored.
    await conn.query("SET FOREIGN_KEY_CHECKS=0");
    await conn.query("SET UNIQUE_CHECKS=0");

    const dbNames = new Set<string>();
    for (const stmt of statements) {
      const upper = stmt.toUpperCase();
      // Match: CREATE DATABASE IF NOT EXISTS `xyz`;
      const createMatch = stmt.match(/CREATE\s+DATABASE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/i);
      if (createMatch) {
        dbNames.add(createMatch[1]);
      }
    }
    for (const dbName of dbNames) {
      try {
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
      } catch (err) {
        console.warn(`[WARN] Gagal pre-create database "${dbName}": ${(err as Error).message}`);
      }
    }
    if (dbNames.size > 0) {
      console.log(`[INFO] Pre-created ${dbNames.size} database: ${[...dbNames].join(", ")}`);
    }

    // Phase 2: Execute each statement individually for resilience
    const tStart = Date.now();

    const saveProgress = async (i: number, label: string) => {
      if (!restoreId) return;
      const pct = Math.round(((i + 1) / statements.length) * 100);
      await prisma.dbRestoreRun.update({
        where: { id: restoreId },
        data: { progressPct: pct, progressText: `${label} (${i + 1}/${statements.length}, ${pct}%)` },
      }).catch(() => {});
    };

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (!stmt) continue;

      try {
        // Per-statement timeout: 60s
        await Promise.race([
          conn.query(stmt),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Query timeout 60s")), 60_000)),
        ]);
      } catch (err) {
        const upper = stmt.toUpperCase();
        const isSpecial =
          upper.startsWith("SET ") ||
          upper.startsWith("CREATE DATABASE") ||
          upper.startsWith("USE ") ||
          upper.startsWith("START TRANSACTION") ||
          upper.startsWith("COMMIT");

        // Special MySQL commands: warn but continue
        if (isSpecial) {
          const msg = `[WARN] Perintah khusus gagal (${i + 1}/${statements.length}): ${truncate(stmt, 80)} — ${(err as Error).message}`;
          console.warn(msg);
          warnings.push(msg);
          warningCount++;
          continue;
        }

        // Regular statements: log warning but DO NOT abort
        const msg = `[WARN] Statement gagal (${i + 1}/${statements.length}): ${truncate(stmt, 80)} — ${(err as Error).message}`;
        console.warn(msg);
        warnings.push(msg);
        warningCount++;
      }

      // Update progress every 5 statements
      if ((i + 1) % 5 === 0 || i === statements.length - 1) {
        const table = stmt.match(/(?:INSERT INTO|CREATE TABLE|CREATE DATABASE|DROP TABLE|ALTER TABLE)\s+[`"']?(\w+)/i)?.[1] ?? "";
        const action = stmt.startsWith("INSERT") ? "Memulihkan data" : stmt.startsWith("CREATE TABLE") ? "Membuat tabel" : stmt.startsWith("DROP") ? "Menghapus tabel" : "Memproses";
        const label = table ? `${action} di ${table}` : action;
        void saveProgress(i, label);
      }

      // Progress log every 50 statements
      if ((i + 1) % 50 === 0) {
        const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
        const rate = ((i + 1) / (Date.now() - tStart) * 1000).toFixed(1);
        console.log(`[RESTORE] Progress: ${i + 1}/${statements.length} statements — ${elapsed}s elapsed — ${rate} stmt/s`);
      }
    }
    const totalSecs = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`[RESTORE] Execution selesai: ${statements.length} statements dalam ${totalSecs}s — ${warningCount} warnings`);

    // Phase 3: Re-enable FK checks after everything is restored
    await conn.query("SET FOREIGN_KEY_CHECKS=1");
    await conn.query("SET UNIQUE_CHECKS=1");

    const message =
      warningCount > 0
        ? `Restore selesai dengan ${warningCount} warning`
        : "Restore selesai";

    return { ok: true, message, warnings: warnings.length > 0 ? warnings : undefined };
  } catch (e) {
    return { ok: false, message: `Restore gagal (tidak terduga): ${(e as Error).message}` };
  } finally {
    await conn.end();
    if (tmpFile) await fsp.rm(tmpFile, { force: true }).catch(() => {});
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

// ---------- retention management ----------

/**
 * Clean up old backup runs for a job based on retention policy.
 * retention=0 means keep all, retention=N means keep the N most recent successful runs.
 * Deletes both the run record and the local file (if applicable).
 */
export async function cleanupRetention(jobId: string): Promise<void> {
  const job = await prisma.dbBackupJob.findUnique({ where: { id: jobId } });
  if (!job || job.retention <= 0) return; // 0 = keep all

  // Get all successful runs for this job, ordered by most recent first
  const runs = await prisma.dbBackupRun.findMany({
    where: { jobId, status: "success" },
    orderBy: { startedAt: "desc" },
  });

  // If we have more runs than retention, delete the extras
  if (runs.length > job.retention) {
    const runsToDelete = runs.slice(job.retention);
    for (const run of runsToDelete) {
      if (job.destType === "local" && run.location) {
        await fsp.rm(run.location, { force: true }).catch(() => {});
      }
      await prisma.dbBackupRun.delete({ where: { id: run.id } }).catch(() => {});
    }
  }
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
    case "hourly":
      return hhmm.endsWith(":00"); // runs at minute 00 every hour
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
