import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export async function readFeatureEnabled(
  tx: Tx,
  companyId: string,
  flag: string,
  decisionAt?: Date,
): Promise<boolean> {
  // تشارك الإجازة لحظتها المحقونة؛ يحتفظ بقية المستدعين بوقت المعاملة المعتاد.
  const at = decisionAt === undefined ? sql`now()` : sql`${decisionAt.toISOString()}::timestamptz`;
  // override لوحده كان يسيب feature شركة اتحذفت شغالة؛ الصف لازم يكون ظاهر وdeleted_at فاضي.
  const [row] = await tx.execute<{ enabled: boolean }>(sql`
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM companies c WHERE c.id = ${companyId} AND c.deleted_at IS NULL
    ) THEN false ELSE COALESCE(
      (SELECT o.enabled FROM company_feature_overrides o
       WHERE o.company_id = ${companyId} AND o.flag = ${flag}
         AND (o.expires_at IS NULL OR o.expires_at > ${at})),
      (SELECT (p.feature_flags ->> ${flag})::boolean
       FROM companies c JOIN plans p ON p.id = c.plan_id WHERE c.id = ${companyId}),
      false) END AS enabled`);
  return row?.enabled === true;
}
