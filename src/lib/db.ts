import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// SQLite dipakai 3 proses sekaligus (web + worker + ws-ssh) pada satu file DB.
// WAL memungkinkan pembaca tetap jalan saat ada penulis; busy_timeout membuat
// penulis menunggu kunci file (default 0 → langsung timeout/P1008); synchronous
// NORMAL mempercepat tulis dan tetap aman di mode WAL.
prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL").catch(() => {});
prisma.$queryRawUnsafe("PRAGMA busy_timeout=10000").catch(() => {});
prisma.$queryRawUnsafe("PRAGMA synchronous=NORMAL").catch(() => {});
