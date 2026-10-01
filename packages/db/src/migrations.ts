import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { bootstrapRoles, type RolePasswords } from './roles.ts';
import { applyMigrations } from './concurrent-migrations.ts';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

// الـ advisory lock محصور في الداتابيز اللي اتاخد فيها، والـ roles على مستوى الـ cluster كله.
// فالـ bootstrap دايماً بيعدّي على داتابيز الصيانة `postgres`، عشان كل تشغيلة — مهما كانت
// الداتابيز اللي بتعمل لها migrate — تستنى على نفس الـ lock.
function maintenanceUrl(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.pathname = '/postgres';
  return url.toString();
}

/**
 * بيجهّز داتابيز كاملة: الـ roles الأول، وبعدين كل الـ migrations بالترتيب.
 * ده المسار الوحيد اللي بيكتب schema — pnpm db:migrate والـ test template الاتنين بيستخدموه.
 *
 * @param ownerUrl  اتصال كـ pospay_owner بالداتابيز المطلوبة
 * @param passwords باسوردات pospay_app و pospay_auth
 * @returns بيخلص بعد ما آخر migration تتطبق
 */
export async function migrateDatabase(ownerUrl: string, passwords: RolePasswords): Promise<void> {
  const maintenance = postgres(maintenanceUrl(ownerUrl), { max: 1, onnotice: () => undefined });
  try {
    await bootstrapRoles(maintenance, passwords);
  } finally {
    await maintenance.end();
  }
  // max_lifetime null: postgres.js would otherwise recycle the one connection after 30–60 minutes, and a long
  // migration would continue on a new session that no longer holds the advisory lock.
  const sql = postgres(ownerUrl, { max: 1, max_lifetime: null, onnotice: () => undefined });
  try {
    await applyMigrations(sql, MIGRATIONS_FOLDER);
  } finally {
    await sql.end();
  }
}
