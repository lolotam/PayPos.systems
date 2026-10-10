import type { ScheduleSettings } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export const SCHEDULE_SETTINGS_ACCESS = Symbol('SCHEDULE_SETTINGS_ACCESS');
export interface ScheduleSettingsAccess {
  read(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<'ALLOWED' | 'NOT_FOUND' | 'FORBIDDEN' | 'FEATURE_DISABLED'>;
}
// شاشة الإعداد وشبكة الجداول تحتاجان القيمة الفعلية حتى قبل أول تغيير للمالك.
export function scheduleSettingsStatement(companyId: string, businessId: string) {
  return sql`SELECT ${businessId}::uuid AS business_id, COALESCE(s.max_shifts_per_day,3) AS max_shifts_per_day,
    s.business_id IS NULL AS is_default,
    to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
    FROM (SELECT 1) seed LEFT JOIN staff_schedule_settings s ON s.company_id=${companyId} AND s.business_id=${businessId}`;
}
export async function getScheduleSettings(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  access: ScheduleSettingsAccess,
) {
  const decision = await access.read(tx, companyId, userId, businessId);
  if (decision !== 'ALLOWED') return decision;
  const [row] = await tx.execute<ScheduleSettings>(
    scheduleSettingsStatement(companyId, businessId),
  );
  if (!row) throw new Error('SCHEDULE_SETTINGS_QUERY_FAILED');
  return row;
}
