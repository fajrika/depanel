// Seed a default admin on first boot — only if the database has NO users yet.
// The first account created becomes the super admin. Override the defaults with
// SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env vars. Safe to run every boot: it
// does nothing once any user exists.
try {
  process.loadEnvFile(".env");
} catch {
  /* no .env file (e.g. Docker) — rely on process.env */
}
import { prisma } from "../src/lib/db";
import bcrypt from "bcryptjs";

const EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@depanel.local";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || "admin";
const NAME = process.env.SEED_ADMIN_NAME || "Administrator";

async function main() {
  const count = await prisma.user.count();
  if (count > 0) {
    console.log(`→ Seed skipped (${count} user(s) already exist).`);
    return;
  }
  await prisma.user.create({
    data: { name: NAME, email: EMAIL, passwordHash: await bcrypt.hash(PASSWORD, 11), role: "admin" },
  });
  console.log(`✅ Default admin created: ${EMAIL} — CHANGE THE PASSWORD after first login.`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", (e as Error).message);
  })
  .finally(() => prisma.$disconnect());
