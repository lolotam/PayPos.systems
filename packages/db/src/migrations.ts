import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { bootstrapRoles, type RolePasswords } from './roles.ts';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * بيجهّز داتابيز كاملة: الـ roles الأول، وبعدين كل الـ migrations بالترتيب.
 * ده المسار الوحيد اللي بيكتب schema — pnpm db:migrate والـ test template الاتنين بيستخدموه.
 *
 * @param ownerUrl  اتصال كـ pospay_owner بالداتابيز المطلوبة
 * @param passwords باسوردات pospay_app و pospay_auth
 * @returns بيخلص بعد ما آخر migration تتطبق
 */
export async function migrateDatabase(ownerUrl: string, passwords: RolePasswords): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await bootstrapRoles(sql, passwords);
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await sql.end();
  }
}
