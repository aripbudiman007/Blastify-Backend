/**
 * Script to create the first SUPER_ADMIN account.
 * Usage: npx ts-node src/scripts/create-admin.ts
 *
 * Set env vars before running:
 *   ADMIN_EMAIL=admin@example.com
 *   ADMIN_PASSWORD=YourSecurePassword123
 *   ADMIN_NAME="Super Admin"
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.ADMIN_EMAIL ?? 'superadmin@example.com';
  const password = process.env.ADMIN_PASSWORD ?? 'Admin@123456';
  const name = process.env.ADMIN_NAME ?? 'Super Admin';

  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    console.log(`✅ Admin already exists: ${email}`);
    return;
  }

  const hashed = await bcrypt.hash(password, 12);
  const admin = await prisma.admin.create({
    data: { email, name, password: hashed, role: 'SUPER_ADMIN' },
  });

  console.log('✅ Super Admin created!');
  console.log(`   Email   : ${admin.email}`);
  console.log(`   Password: ${password}`);
  console.log(`   Role    : ${admin.role}`);
  console.log('\n⚠️  Change the password after first login!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
