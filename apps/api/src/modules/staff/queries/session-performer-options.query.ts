import { sessionPerformerCursorData, sessionPerformerOptionPage, type SessionPerformerOptionsQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';

function searchHash(normalizedQ: string) {
  return createHash('sha256').update(normalizedQ).digest('hex');
}

async function normalizeSearch(tx: Tx, query: SessionPerformerOptionsQuery) {
  if (query.q === undefined) return '';
  const [row] = await tx.execute<{ normalized_q: string }>(sql`SELECT lower(${query.q.trim()}::text COLLATE "und-x-icu") AS normalized_q`);
  if (row === undefined) throw new Error('Session performer search normalization missing');
  return row.normalized_q;
}

function decodeCursor(query: SessionPerformerOptionsQuery, normalizedQ: string) {
  if (query.cursor === undefined) return null;
  try {
    const cursor = sessionPerformerCursorData.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
    if (Buffer.from(JSON.stringify(cursor)).toString('base64url') !== query.cursor ||
      cursor.lang !== query.lang || cursor.q_hash !== searchHash(normalizedQ)) throw new Error();
    return cursor;
  } catch { throw new RangeError('SESSION_PERFORMER_CURSOR_INVALID'); }
}

// نموذج التسجيل ولقطة الحفظ يستهلكان حقائق يوم الأداء نفسها دون اشتراط جلسة حضور مفتوحة الآن.
export function sessionPerformerWarningColumns(branchId: string, day: string, occurredAt: Date) {
  return sql`EXISTS(SELECT 1 FROM attendance_sessions a WHERE a.company_id=e.company_id AND a.employee_id=e.id
    AND a.branch_id=${branchId} AND a.working_date=${day}::date AND a.voided_at IS NULL
    AND a.status IN ('OPEN','CLOSED','MISSED_OUT')) AS clocked_in,
    EXISTS(SELECT 1 FROM leave_requests l WHERE l.company_id=e.company_id AND l.employee_id=e.id AND l.status='APPROVED'
      AND ((l.kind='FULL_DAY' AND l."from"<=${day}::date AND l."to">=${day}::date)
        OR (l.kind='PARTIAL' AND l.starts_at<=${occurredAt.toISOString()}::timestamptz
          AND l.ends_at>${occurredAt.toISOString()}::timestamptz))) AS approved_leave`;
}

// منتقي الموظفات يعرض الأهلية التاريخية والأسماء والتنبيهين فقط؛ فلاتر الأهلية تسبق حد الصفحة.
export function sessionPerformerOptionsStatement(companyId: string, businessId: string, branchId: string,
  day: string, query: SessionPerformerOptionsQuery, normalizedQ: string) {
  const name = query.lang === 'ar'
    ? sql`coalesce(e.name_ar,e.name_en) COLLATE "und-x-icu"`
    : sql`coalesce(e.name_en,e.name_ar) COLLATE "und-x-icu"`;
  const cursor = decodeCursor(query, normalizedQ);
  const escapedQ = query.q?.trim().replace(/[\\%_]/g, '\\$&');
  const after = cursor === null ? sql``
    : sql`AND (${name},e.id)>(${cursor.key}::text COLLATE "und-x-icu",${cursor.id}::uuid)`;
  return sql`SELECT e.id,e.name_ar,e.name_en,${name} AS sort_key,${sessionPerformerWarningColumns(branchId, day, new Date(query.occurred_at))}
    FROM employees e WHERE e.company_id=${companyId} AND e.business_id=${businessId}
      AND e.deleted_at IS NULL AND e.hire_date<=${day}::date AND (e.contract_end IS NULL OR e.contract_end>=${day}::date)
      AND EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.business_id=e.business_id
        AND eb.employee_id=e.id AND eb.branch_id=${branchId} AND eb."from"<=${day}::date AND (eb."to" IS NULL OR eb."to">${day}::date))
      ${after}
      ${escapedQ === undefined ? sql`` : sql`AND (lower(e.name_ar COLLATE "und-x-icu") LIKE '%' || lower(${escapedQ}::text COLLATE "und-x-icu") || '%' ESCAPE ${'\\'}
        OR lower(e.name_en COLLATE "und-x-icu") LIKE '%' || lower(${escapedQ}::text COLLATE "und-x-icu") || '%' ESCAPE ${'\\'})`}
    ORDER BY ${name} ASC,e.id ASC LIMIT ${query.limit + 1}`;
}
export async function sessionPerformerOptionsPage(tx: Tx, companyId: string, businessId: string, branchId: string,
  day: string, query: SessionPerformerOptionsQuery) {
  const normalizedQ = await normalizeSearch(tx, query);
  const rows = await tx.execute<{ id: string; name_ar: string | null; name_en: string; sort_key: string; clocked_in: boolean; approved_leave: boolean }>(
    sessionPerformerOptionsStatement(companyId, businessId, branchId, day, query, normalizedQ));
  const items = rows.slice(0, query.limit).map((r) => ({ id: r.id, name_ar: r.name_ar, name_en: r.name_en,
    not_clocked_in_warning: !r.clocked_in, approved_leave_warning: r.approved_leave }));
  const last = rows[items.length - 1];
  return sessionPerformerOptionPage.parse({ items, next_cursor: rows.length > query.limit && last !== undefined
    ? Buffer.from(JSON.stringify({ key: last.sort_key, id: last.id, lang: query.lang, q_hash: searchHash(normalizedQ) })).toString('base64url') : null });
}
