import type { ScheduleSettings } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export const SCHEDULE_SETTINGS_ACCESS = Symbol('SCHEDULE_SETTINGS_ACCESS');
export interface ScheduleSettingsAccess {
  branches(tx: Tx, companyId: string, businessId: string): Promise<string[]>;
  read(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<'ALLOWED' | 'NOT_FOUND' | 'FORBIDDEN' | 'FEATURE_DISABLED'>;
}
// شاشة الإعداد وشبكة الجداول تحتاجان القيمة الفعلية حتى قبل أول تغيير للمالك.
export function scheduleSettingsStatement(
  companyId: string,
  businessId: string,
  branchIds: readonly string[] = [],
) {
  return sql`SELECT ${businessId}::uuid AS business_id, COALESCE(s.max_shifts_per_day,3) AS max_shifts_per_day,
    s.business_id IS NULL AS is_default,
    to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id',active.id,
      'max_shifts_per_day',COALESCE(b.max_shifts_per_day,s.max_shifts_per_day,3),
      'source',CASE WHEN b.branch_id IS NOT NULL THEN 'branch' WHEN s.business_id IS NOT NULL THEN 'business' ELSE 'default' END,
      'updated_at',to_char(b.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY active.id)
      FROM jsonb_array_elements_text(${JSON.stringify(branchIds)}::jsonb) active(id)
      LEFT JOIN staff_branch_schedule_settings b ON b.company_id=${companyId} AND b.business_id=${businessId} AND b.branch_id=active.id::uuid),'[]'::jsonb) AS branches
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
  const branchIds = await access.branches(tx, companyId, businessId);
  const [row] = await tx.execute<ScheduleSettings>(
    scheduleSettingsStatement(companyId, businessId, branchIds),
  );
  if (!row) throw new Error('SCHEDULE_SETTINGS_QUERY_FAILED');
  return row;
}
