import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { ShiftTemplate } from '@pospay/contracts';
import type { ScheduleReadAccess } from './schedule-week.query.ts';

// قائمة القوالب تحتاج نسختها وحالة أرشفتها لتمنع استعمال نمط قديم من شاشة الإدارة.
export function shiftTemplatesStatement(
  companyId: string,
  businessId: string,
  query: { cursor?: string; limit: number },
) {
  return sql`SELECT id,jsonb_build_object('id',id,'business_id',business_id,'name_en',name_en,'name_ar',name_ar,'shifts',shifts,'revision',revision,
    'archived_at',CASE WHEN archived_at IS NULL THEN NULL ELSE to_char(archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END) AS record
    FROM staff_shift_templates WHERE company_id=${companyId} AND business_id=${businessId}
      AND (${query.cursor ?? null}::uuid IS NULL OR id > ${query.cursor ?? null}::uuid) ORDER BY id LIMIT ${query.limit + 1}`;
}
export async function listShiftTemplates(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  query: { cursor?: string; limit: number },
  access: ScheduleReadAccess,
) {
  const context = await access.read(tx, companyId, userId, businessId, null);
  if (typeof context === 'string') return context;
  const rows = await tx.execute<{ id: string; record: ShiftTemplate }>(
    shiftTemplatesStatement(companyId, businessId, query),
  );
  return {
    items: rows.slice(0, query.limit).map((r) => r.record),
    next_cursor: rows.length > query.limit ? (rows[query.limit - 1]?.id ?? null) : null,
  };
}
