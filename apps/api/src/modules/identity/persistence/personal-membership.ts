import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** العضوية الحية قراءة فقط قبل OTP، وتثبت تحت القفل عند ربط الاعتماد. */
export async function personalMemberships(tx: Tx, companyId: string, userId: string, lock = false) {
  const [company] = await tx.execute(
    sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL ${lock ? sql`FOR NO KEY UPDATE` : sql``}`,
  );
  if (company === undefined) return [];
  if (lock)
    await tx.execute(
      sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR SHARE`,
    );
  return tx.execute<{ scope_type: 'COMPANY' | 'BUSINESS' | 'BRANCH'; scope_id: string }>(sql`
    SELECT scope_type,scope_id FROM memberships WHERE company_id=${companyId} AND user_id=${userId}
      AND starts_at<=clock_timestamp() AND (ends_at IS NULL OR ends_at>clock_timestamp())`);
}
