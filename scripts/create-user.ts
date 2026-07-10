// Create or update a team member.
// Usage: npm run user -- <email> <password> "<name>" [admin|member]
process.loadEnvFile(".env");
import { prisma } from "../src/lib/db";
import bcrypt from "bcryptjs";

async function main() {
  const [email, password, name, role = "member"] = process.argv.slice(2);
  if (!email || !password || !name) {
    console.error('Usage: npm run user -- <email> <password> "<name>" [admin|member]');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 11);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, name, role },
    update: { passwordHash, name, role, active: true },
  });
  console.log(`✅ User siap: ${user.email} (${user.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
