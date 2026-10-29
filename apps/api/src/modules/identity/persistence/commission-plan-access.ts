import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';

const PERMISSION = 'manage:commission-plans:business';

/** يعيد قرار صلاحية الخطة داخل معاملة الكاتب بعد أقفالها، بلا فتح معاملة ثانية. */
export async function readCommissionPlanAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<'FORBIDDEN' | null> {
  const [business] = await tx.execute(sql`SELECT id FROM businesses
    WHERE company_id=${companyId} AND id=${businessId}
      AND EXISTS (SELECT 1 FROM companies WHERE id=${companyId} AND deleted_at IS NULL)`);
  if (business === undefined) return 'FORBIDDEN';
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return 'FORBIDDEN';
  const access = await readAccessTransaction(tx, companyId, userId, new Date(time.at));
  return evaluateAccess(access.grants, PERMISSION, { companyId, businessId }) ? null : 'FORBIDDEN';
}
