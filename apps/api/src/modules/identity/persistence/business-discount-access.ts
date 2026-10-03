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
  await tx.execute(sql`SELECT id FROM businesses
    WHERE company_id=${companyId} AND id=${businessId} FOR SHARE`);
  return readBusinessDiscountAccess(tx, companyId, userId, businessId);
}

// الفحص النهائي يفترض بقاء أقفال check في نفس المعاملة؛ لا يأخذ قفلًا بعد صف الإعدادات.
export async function readBusinessDiscountAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
) {
  const [business] = await tx.execute(sql`SELECT id FROM businesses
    WHERE company_id=${companyId} AND id=${businessId}
      AND EXISTS (SELECT 1 FROM companies WHERE id=${companyId} AND deleted_at IS NULL)`);
  const branches = await tx.execute<{ id: string }>(sql`SELECT id FROM branches
    WHERE company_id=${companyId} AND business_id=${businessId}`);
  // وقت الفحص النهائي يأتي بعد انتظار صف الإعدادات، لا من بداية المعاملة أو الفحص الأول.
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
