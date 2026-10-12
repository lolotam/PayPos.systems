import { serviceSessionDayCursor, serviceSessionDayPage, serviceSessionDayQuery,
  type ServiceSessionDayCursor, type ServiceSessionDayPage, type ServiceSessionDayQuery } from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export interface SessionDayScope {
  companyId: string; userId: string; businessId: string; branchId: string;
}
export interface SessionDayAccess {
  /** يثبت النشاط والفرع قبل كشف زيارة أو قبول مؤشر الصفحة. */
  place(tx: Tx, scope: SessionDayScope): Promise<boolean>;
  /** يعيد فحص إذن القراءة والميزة داخل معاملة كل صفحة. */
  read(tx: Tx, scope: SessionDayScope): Promise<'ALLOWED' | 'DENIED' | 'FEATURE_DISABLED'>;
}
export class SessionDayReadError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'FEATURE_DISABLED' | 'VALIDATION_FAILED' | 'NOT_READY') { super(code); }
}
function cursorScope(scope: SessionDayScope, query: ServiceSessionDayQuery) {
  return { v: 1 as const, company: scope.companyId, business: scope.businessId, branch: scope.branchId,
    date: query.date, late: query.late === 'true' };
}
function decode(scope: SessionDayScope, query: ServiceSessionDayQuery): ServiceSessionDayCursor | null {
  if (query.cursor === undefined) return null;
  try {
    const bytes = Buffer.from(query.cursor, 'base64url');
    if (bytes.toString('base64url') !== query.cursor) throw new Error();
    const cursor = serviceSessionDayCursor.parse(JSON.parse(bytes.toString('utf8')));
    const expected = cursorScope(scope, query);
    if (cursor.company === expected.company && cursor.business === expected.business && cursor.branch === expected.branch &&
      cursor.date === expected.date && cursor.late === expected.late) return cursor;
  } catch { /* بيانات المؤشر لا تدخل التشخيصات. */ }
  throw new SessionDayReadError('VALIDATION_FAILED');
}
const headerColumns = sql`s.company_id,s.id,s.business_id,s.branch_id,s.customer_id,s.customer_name,
  s.occurred_at,s.recorded_at,s.business_date,s.business_timezone,s.recorded_by,s.late`;
const lateLines = sql`EXISTS(SELECT 1 FROM service_lines late_line
  WHERE late_line.company_id=s.company_id AND late_line.session_id=s.id AND late_line.late)`;
const occurred = sql`to_char(s.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// شاشة جلسات يوم الفرع تقسم الزيارات أولاً ثم تجمع البنود والمؤديات المحفوظات دون هاتف أو قراءة سياق آخر.
export function branchDayServiceSessionsStatement(scope: SessionDayScope, query: ServiceSessionDayQuery) {
  const cursor = decode(scope, query);
  const where = sql`s.company_id=${scope.companyId} AND s.business_id=${scope.businessId}
    AND s.branch_id=${scope.branchId} AND s.business_date=${query.date}::date
    ${cursor === null ? sql`` : sql`AND (s.occurred_at,s.id)<(${cursor.at}::text::timestamptz,${cursor.id}::uuid)`}`;
  const candidates = query.late === 'true'
    ? sql`SELECT ${headerColumns} FROM service_sessions s WHERE ${where} AND s.late
      UNION ALL SELECT ${headerColumns} FROM service_sessions s WHERE ${where} AND NOT s.late AND ${lateLines}`
    : sql`SELECT ${headerColumns} FROM service_sessions s WHERE ${where}`;
  return sql`WITH candidates AS (${candidates}), visits AS (
    SELECT company_id,id,business_id,branch_id,customer_id,customer_name,occurred_at,recorded_at,
      business_date,business_timezone,recorded_by,late FROM candidates ORDER BY occurred_at DESC,id DESC LIMIT ${query.limit + 1})
    SELECT ${occurred} AS cursor_at,s.id AS cursor_id,jsonb_build_object(
      'id',s.id,'business_id',s.business_id,'branch_id',s.branch_id,'customer',jsonb_build_object('id',s.customer_id,'name',s.customer_name),
      'occurred_at',${occurred},'recorded_at',to_char(s.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'business_date',to_char(s.business_date,'YYYY-MM-DD'),'business_timezone',s.business_timezone,
      'recorded_by',s.recorded_by,'late',s.late OR ${lateLines},'lines',COALESCE(lines.items,'[]'::jsonb)) AS item
    FROM visits s LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('id',l.id,'service_id',l.service_id,'ordinal',l.ordinal,
        'name_ar',l.name_ar,'name_en',l.name_en,'status',l.status,'revision',l.revision,
        'list_price',l.list_price::text,'price',l.price::text,'discount',l.discount::text,'net',l.net::text,
        'effective_discount_bps',l.effective_discount_bps,'recorded_by',l.recorded_by,
        'recorded_at',to_char(l.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'late',l.late,'has_performer_warning',l.has_performer_warning,
        'performers',COALESCE(performers.items,'[]'::jsonb)) ORDER BY l.ordinal) AS items
      FROM service_lines l LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('employee_id',p.employee_id,'name_ar',p.name_ar,'name_en',p.name_en,
          'share_bps',p.share_bps,'not_clocked_in_warning',p.not_clocked_in_warning,
          'approved_leave_warning',p.approved_leave_warning) ORDER BY p.performer_ordinal) AS items
        FROM line_performers p WHERE p.company_id=l.company_id AND p.business_id=l.business_id AND p.line_id=l.id
      ) performers ON true WHERE l.company_id=s.company_id AND l.business_id=s.business_id AND l.session_id=s.id
    ) lines ON true ORDER BY s.occurred_at DESC,s.id DESC`;
}
export class BranchDayServiceSessionsQuery {
  constructor(private readonly db: TenantWrappers, private readonly access: SessionDayAccess) {}
  async execute(scope: SessionDayScope, input: ServiceSessionDayQuery): Promise<ServiceSessionDayPage> {
    const query = serviceSessionDayQuery.parse(input);
    const statement = branchDayServiceSessionsStatement(scope, query);
    try {
      return await this.db.withTenant(scope.companyId, async (tx) => {
        if (!await this.access.place(tx, scope)) throw new SessionDayReadError('FORBIDDEN');
        const access = await this.access.read(tx, scope);
        if (access !== 'ALLOWED') throw new SessionDayReadError(access === 'DENIED' ? 'FORBIDDEN' : 'FEATURE_DISABLED');
        const rows = await tx.execute<{ item: ServiceSessionDayPage['items'][number]; cursor_at: string; cursor_id: string }>(statement);
        const last = rows[Math.min(rows.length, query.limit) - 1];
        return serviceSessionDayPage.parse({ items: rows.slice(0, query.limit).map((row) => row.item),
          next_cursor: rows.length > query.limit && last !== undefined
            ? Buffer.from(JSON.stringify({ ...cursorScope(scope, query), at: last.cursor_at, id: last.cursor_id })).toString('base64url') : null });
      }, { userId: scope.userId });
    } catch (error) {
      if (error instanceof SessionDayReadError) throw error;
      throw new SessionDayReadError('NOT_READY');
    }
  }
}
