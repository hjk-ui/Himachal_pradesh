/**
 * Bootstrap platform SUPER_ADMIN from env vars.
 *
 * Usage:
 *   PLATFORM_ADMIN_NAME="Platform Admin" \
 *   PLATFORM_ADMIN_EMAIL="you@altrixs.com" \
 *   PLATFORM_ADMIN_PASSWORD="StrongPass123" \
 *   npm run db:create-platform-admin
 */
import { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const name =
    process.env.PLATFORM_ADMIN_NAME?.trim() ||
    process.env.ADMIN_NAME?.trim() ||
    'Platform Admin';
  const email = (
    process.env.PLATFORM_ADMIN_EMAIL ||
    process.env.ADMIN_EMAIL ||
    ''
  )
    .trim()
    .toLowerCase();
  const password =
    process.env.PLATFORM_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error(
      'Set PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD (or ADMIN_EMAIL / ADMIN_PASSWORD).'
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('PLATFORM_ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  const passwordHash = await hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      role: Role.SUPER_ADMIN,
      status: 'ACTIVE',
      organizationId: null,
      primaryLocationId: null,
    },
    create: {
      name,
      email,
      passwordHash,
      role: Role.SUPER_ADMIN,
      status: 'ACTIVE',
      organizationId: null,
    },
  });

  console.log('Platform SUPER_ADMIN ready:');
  console.log(`  ${user.email} (${user.role})`);
  console.log('  Sign in → /platform');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
