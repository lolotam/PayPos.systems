import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { businessDiscountEditFailure } from '../domain/business-discount-edit.ts';
import { readAccessTransaction } from './access-reader.ts';

export async function lockBusinessDiscountAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
) {
  const [company] = await tx.execute(sql`SELECT id FROM companies
    WHERE id=${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`);
  if (company === undefined) return { failure: 'FORBIDDEN' as const, decidedAt: null };
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR UPDATE`,
  );
  const [business] = await tx.execute(sql`SELECT id FROM businesses
    WHERE company_id=${companyId} AND id=${businessId} FOR SHARE`);
  const branches = await tx.execute<{ id: string }>(sql`SELECT id FROM branches
    WHERE company_id=${companyId} AND business_id=${businessId}`);
  // وقت القرار يأتي بعد آخر قفل؛ انتظار تعديل النشاط لا يمد صلاحية إذن انتهى أثناء الانتظار.
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) throw new Error('Transaction time missing');
  const now = new Date(time.at);
  const access = await readAccessTransaction(tx, companyId, userId, now);
  const target = business === undefined ? null : { companyId, businessId };
  return {
    failure: businessDiscountEditFailure(
      access.grants,
      target,
      branches.map((branch) => ({ companyId, businessId, branchId: branch.id })),
    ),
    decidedAt: now.toISOString(),
  };
}
