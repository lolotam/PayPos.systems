import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/** يثبت إذن استيراد الباقات وميزة orders على نفس معاملة المعاينة، بلا اتصال ثانٍ. */
export async function readPackageImportAccess(
  tx: Tx,
  actor: { companyId: string; userId: string; businessId: string },
): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null> {
  const [company] = await tx.execute(sql`SELECT id FROM companies
    WHERE id=${actor.companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`);
  if (company === undefined) return 'FORBIDDEN';
  await tx.execute(sql`SELECT id FROM memberships
    WHERE company_id=${actor.companyId} AND user_id=${actor.userId} ORDER BY id FOR UPDATE`);
  const [business] =
    await tx.execute(sql`SELECT b.id FROM businesses b JOIN companies c ON c.id=b.company_id
    WHERE b.company_id=${actor.companyId} AND b.id=${actor.businessId} AND c.deleted_at IS NULL`);
  if (business === undefined) return 'FORBIDDEN';
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return 'FORBIDDEN';
  const access = await readAccessTransaction(tx, actor.companyId, actor.userId, new Date(time.at));
  if (!evaluateAccess(access.grants, 'import:packages:business', actor)) return 'FORBIDDEN';
  return (await readFeatureEnabled(tx, actor.companyId, 'orders', new Date(time.at)))
    ? null
    : 'FEATURE_DISABLED';
}
