import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// أقفال SHARE تحفظ ترتيب الكتابة نفسه وتمنع قراءة حد شخصي من زمن وافتراضي نشاط من زمن آخر.
export async function lockMembershipDiscountSubject(
  tx: Tx,
  companyId: string,
  membershipId: string,
) {
  const [company] = await tx.execute(sql`SELECT id FROM companies
    WHERE id=${companyId} AND deleted_at IS NULL FOR SHARE`);
  if (company === undefined) return false;
  const [membership] = await tx.execute(sql`SELECT id FROM memberships
    WHERE company_id=${companyId} AND id=${membershipId} FOR SHARE`);
  return membership !== undefined;
}
