import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';

// نفس بروتوكول PR 7: تثبيت العضويات يحمي الإنشاء من تغير الإذن أثناء الانتظار.
export async function lockEmployeeCreationAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
): Promise<boolean> {
  const [company] = await tx.execute(
    sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`,
  );
  if (company === undefined) return false;
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR UPDATE`,
  );
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return false;
  const access = await readAccessTransaction(tx, companyId, userId, new Date(time.at));
  return evaluateAccess(access.grants, 'manage:employees:business', {
    companyId,
    businessId,
    branchId,
  });
}
