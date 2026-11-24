import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** قراءة وجود فقط، بلا حد تاريخ أعلى كي لا تختفي تواريخ PostgreSQL التي تتجاوز سنة 9999. */
export function sessionTipsAfterBoundStatement(
  companyId: string,
  businessId: string,
  bound: string,
) {
  return sql`SELECT
    EXISTS (SELECT 1 FROM businesses b WHERE b.company_id = ${companyId} AND b.id = ${businessId}
      AND b.company_id = app_company_id()) AS business_known,
    EXISTS (SELECT 1 FROM service_sessions s WHERE s.company_id = ${companyId}
      AND s.company_id = app_company_id() AND s.business_id = ${businessId} AND s.business_date > ${bound}::date
      AND EXISTS (SELECT 1 FROM session_tip_revisions r WHERE r.company_id = s.company_id
        AND r.business_id = s.business_id AND r.session_id = s.id)) AS tips_exist`;
}

/** يتحقق من المستأجر والنشاط قبل تفسير غياب السجلات كدليل تغطية. */
export async function readSessionTipsAfterBound(
  tx: Tx,
  companyId: string,
  businessId: string,
  bound: string,
): Promise<boolean> {
  const [tenant] = await tx.execute<{ id: string | null }>(
    sql`SELECT app_company_id()::text AS id`,
  );
  if (tenant?.id !== companyId.toLowerCase()) throw new Error('COVERAGE_TENANT_MISMATCH');
  const [row] = await tx.execute<{ business_known: boolean; tips_exist: boolean }>(
    sessionTipsAfterBoundStatement(companyId, businessId, bound),
  );
  if (row?.business_known !== true || typeof row.tips_exist !== 'boolean')
    throw new Error('COVERAGE_SCOPE_INCOMPLETE');
  return row.tips_exist;
}
