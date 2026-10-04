import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** خيارات التسجيل بعد إثبات الجلسة: شركات المستخدم فقط، دون صلاحيات أو بيانات شركة. */
export function membershipCompanies(database: TenantWrappers, userId: string) {
  return database.withUser(userId, async (tx) => {
    const rows = await tx.execute<{ company_id: string }>(sql`
      SELECT DISTINCT company_id FROM memberships WHERE user_id=${userId}`);
    return rows.map((row) => row.company_id);
  });
}
