import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** يحفظ يوم طلب التقييم للزيارة أول مرة ويُعيد اليوم المخزَّن دائماً دون كتابة إذا كان محفوظاً بالفعل. */
export async function assignSessionRequestDay(
  tx: Tx,
  companyId: string,
  businessId: string,
  sessionId: string,
  requestDay: string,
): Promise<string> {
  const existing = await tx.execute<{ rating_request_day: string | null }>(sql`
    SELECT rating_request_day::text AS rating_request_day
      FROM service_sessions
     WHERE company_id = ${companyId} AND company_id = app_company_id()
       AND business_id = ${businessId} AND id = ${sessionId}`);
  const row = existing[0];
  if (row === undefined) throw new Error('SERVICE_SESSION_NOT_FOUND');
  if (row.rating_request_day !== null) return row.rating_request_day;
  const updated = await tx.execute<{ rating_request_day: string }>(sql`
    UPDATE service_sessions
       SET rating_request_day = COALESCE(rating_request_day, ${requestDay}::date)
     WHERE company_id = ${companyId} AND company_id = app_company_id()
       AND business_id = ${businessId} AND id = ${sessionId}
    RETURNING rating_request_day::text AS rating_request_day`);
  const stored = updated[0]?.rating_request_day;
  if (stored === undefined) throw new Error('SERVICE_SESSION_NOT_FOUND');
  return stored;
}
