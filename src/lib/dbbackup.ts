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
import crypto from "node:crypto";
import { CronExpressionParser } from "cron-parser";
import { prisma } from "./db";
import { decryptSecret } from "./crypto";
import { notifyTeam } from "./notify";

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

// ---------- Google Drive helper (native fetch + JWT, no googleapis) ----------

interface GDriveSA { client_email: string; private_key: string }

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

function parseSAKey(cfg: DestConfig): GDriveSA {
  const keyJson = cfg.serviceAccountKeyEnc ? decryptSecret(String(cfg.serviceAccountKeyEnc)) : cfg.serviceAccountKey;
  if (!keyJson || typeof keyJson !== "string") throw new Error("Service Account Key Google Drive belum diisi");
  try {
    const parsed = JSON.parse(keyJson);
    if (!parsed.client_email || !parsed.private_key) throw new Error();
    return parsed;
  } catch {
    throw new Error("Service Account Key JSON tidak valid");
  }
}

/** Sign a minimal RS256 JWT and exchange it for a Google OAuth2 access token. */
async function getGDriveToken(sa: GDriveSA): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claim = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })).toString("base64url");
  const signed = crypto.sign("sha256", Buffer.from(`${header}.${claim}`), sa.private_key);
  const jwt = `${header}.${claim}.${signed.toString("base64url")}`;

  return withRetry(async () => {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    });
    if (!res.ok) throw new Error(`GDrive token error: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  });
}

/** Upload a file to Google Drive, return file id. */
async function gdriveUpload(token: string, folderId: string, fileName: string, filePath: string): Promise<string> {
  const fileBytes = await fsp.readFile(filePath);
  const boundary = "----Depanel" + crypto.randomUUID();
  const metadata = JSON.stringify({ name: fileName, parents: folderId ? [folderId] : undefined });
  const preamble = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(preamble), fileBytes, Buffer.from(epilogue)]);

  return withRetry(async () => {
    const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`GDrive upload error: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { id: string };
    return data.id;
  });
}

/** Download a file from Google Drive by file id. */
async function gdriveDownload(token: string, fileId: string, destPath: string): Promise<void> {
  await withRetry(async () => {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`GDrive download error: ${res.status} ${await res.text()}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fsp.writeFile(destPath, buf);
  });
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

  if (destType === "gdrive") {
    const sa = parseSAKey(cfg);
    const token = await getGDriveToken(sa);
    const folderId = String(cfg.folderId || "");
    const fileId = await gdriveUpload(token, folderId, fileName, filePath);
    return `gdrive://${fileId}`;
  }

  throw new Error(`Tujuan backup tidak dikenal: ${destType}`);
}

/**
 * Fetch a backup file from any destination (local / FTP / S3) to a local temp path.
 * The caller is responsible for cleaning up the returned file.
 */
export async function fetchBackup(destType: string, cfg: DestConfig, location: string): Promise<string> {
  if (destType === "local") {
    await fsp.access(location);
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
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await resp.Body!.transformToByteArray();
    await fsp.writeFile(tmpFile, body);
    return tmpFile;
  }

  if (destType === "gdrive") {
    const sa = parseSAKey(cfg);
    const token = await getGDriveToken(sa);
    const fileId = location.replace(/^gdrive:\/\//, "");
    await gdriveDownload(token, fileId, tmpFile);
    return tmpFile;
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

    // Clean up old backups based on retention policy
    await cleanupRetention(jobId);

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
 *
 * Uses resilient per-statement execution: individual statement failures are
 * logged as warnings but do NOT abort the entire restore. This ensures that
 * the restore completes even if some statements fail (e.g., due to data
 * conflicts, missing dependencies, or partial corruption).
 */
export async function restoreRun(runId: string): Promise<{ ok: boolean; message: string; warnings?: string[] }> {
  const run = await prisma.dbBackupRun.findUnique({
    where: { id: runId },
    include: { job: { include: { connection: true } } },
  });
  if (!run) return { ok: false, message: "Run tidak ditemukan" };
  if (run.status !== "success" || !run.location) return { ok: false, message: "Run ini tidak punya arsip yang valid" };

  const cfg: ConnCfg = {
    host: run.job.connection.host,
    port: run.job.connection.port,
    username: run.job.connection.username,
    password: decryptSecret(run.job.connection.passwordEnc),
  };

  // Fetch the backup file (local path, or download from FTP/S3)
  const destCfg = JSON.parse(run.job.destConfig) as DestConfig;
  let tmpFile: string | null = null;
  let file: string;
  try {
    file = await fetchBackup(run.job.destType, destCfg, run.location);
    if (file !== run.location) tmpFile = file;
  } catch (e) {
    return { ok: false, message: `Gagal mengambil arsip: ${(e as Error).message}` };
  }

  // Stream-gunzip the dump into a string
  const gunzip = zlib.createGunzip();
  const chunks: Buffer[] = [];
  await pipeline(fs.createReadStream(file), gunzip, async function* (source) {
    for await (const c of source) chunks.push(c as Buffer);
    yield; // satisfy pipeline sink
  });
  const sql = Buffer.concat(chunks).toString("utf8");

  // Split into individual statements for resilient execution
  const statements = splitStatements(sql);
  const warnings: string[] = [];
  let warningCount = 0;

  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.username,
    password: cfg.password,
    connectTimeout: 15_000,
  });

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
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (!stmt) continue;

      try {
        await conn.query(stmt);
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

      // Progress log every 100 statements
      if ((i + 1) % 100 === 0) {
        console.log(`[INFO] Progress: ${i + 1}/${statements.length} statement`);
      }
    }

    // Phase 3: Re-enable FK checks after everything is restored
    await conn.query("SET FOREIGN_KEY_CHECKS=1");
    await conn.query("SET UNIQUE_CHECKS=1");

    const message =
      warningCount > 0
        ? `Restore selesai dengan ${warningCount} warning`
        : "Restore selesai";

    return { ok: true, message, warnings: warnings.length > 0 ? warnings : undefined };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
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
