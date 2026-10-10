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
  return sql`WITH rows AS (SELECT id,jsonb_build_object('id',id,'business_id',business_id,'name_en',name_en,'name_ar',name_ar,'shifts',COALESCE((SELECT jsonb_agg(entry || jsonb_build_object(
      'break_start',entry->'break_start','break_end',entry->'break_end') ORDER BY ordinal)
      FROM jsonb_array_elements(shifts) WITH ORDINALITY AS pattern(entry,ordinal)),'[]'::jsonb),'revision',revision,
    'archived_at',CASE WHEN archived_at IS NULL THEN NULL ELSE to_char(archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END) AS record
    FROM staff_shift_templates WHERE company_id=${companyId} AND business_id=${businessId}
      AND (${query.cursor ?? null}::uuid IS NULL OR id > ${query.cursor ?? null}::uuid) ORDER BY id LIMIT ${query.limit + 1})
    SELECT COALESCE(jsonb_agg(record ORDER BY id),'[]'::jsonb) AS items,
      COALESCE((SELECT max_shifts_per_day FROM staff_schedule_settings WHERE company_id=${companyId} AND business_id=${businessId}),3) AS max_shifts_per_day FROM rows`;
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
  const [page] = await tx.execute<{ items: ShiftTemplate[]; max_shifts_per_day: number }>(
    shiftTemplatesStatement(companyId, businessId, query),
  );
  if (!page) throw new Error('SCHEDULE_QUERY_FAILED');
  const rows = page.items;
  return {
    max_shifts_per_day: page.max_shifts_per_day,
    items: rows.slice(0, query.limit),
    next_cursor: rows.length > query.limit ? (rows[query.limit - 1]?.id ?? null) : null,
  };
}
