import { serviceLinePerformerChangesCursor, serviceLinePerformerChangesPage, serviceLinePerformerChangesQuery,
  type ServiceLinePerformerChangesCursor, type ServiceLinePerformerChangesPage, type ServiceLinePerformerChangesQuery } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { editorLabel } from '@pospay/i18n';
import { sql } from 'drizzle-orm';
import { SessionDayReadError, type SessionDayAccess, type SessionDayScope } from './branch-day-service-sessions.query.ts';

export interface ServiceLinePerformerChangesScope extends SessionDayScope {
  sessionId: string;
  lineId: string;
}
type ChangeRow = {
  revision: number | null;
  changed_at: string | null;
  reason: string | null;
  changer_name_ar: string | null; changer_name_en: string | null; changer_role: string | null;
  changer_role_is_system: boolean | null; changer_role_name_ar: string | null; changer_role_name_en: string | null;
  before_side: unknown; after_side: unknown;
};
function cursorScope(scope: ServiceLinePerformerChangesScope) {
  return { v: 1 as const, company: scope.companyId, business: scope.businessId, branch: scope.branchId,
    session: scope.sessionId, line: scope.lineId };
}
function decode(scope: ServiceLinePerformerChangesScope, query: ServiceLinePerformerChangesQuery): ServiceLinePerformerChangesCursor | null {
  if (query.cursor === undefined) return null;
  try {
    const bytes = Buffer.from(query.cursor, 'base64url');
    if (bytes.toString('base64url') !== query.cursor) throw new Error();
    const cursor = serviceLinePerformerChangesCursor.parse(JSON.parse(bytes.toString('utf8')));
    const expected = cursorScope(scope);
    if (cursor.company === expected.company && cursor.business === expected.business && cursor.branch === expected.branch &&
      cursor.session === expected.session && cursor.line === expected.line) return cursor;
  } catch { /* بيانات المؤشر لا تدخل التشخيصات. */ }
  throw new SessionDayReadError('VALIDATION_FAILED');
}
const changedAt = sql`to_char(hist.changed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
// جانب واحد من التغيير: الاسم والنسبة فقط، بلا معرّف الموظف ولا رابط المستخدم ولا التحذيرات (FR-016).
function side(which: 'BEFORE' | 'AFTER') {
  return sql`(SELECT jsonb_agg(jsonb_build_object('name_ar',r.name_ar,'name_en',r.name_en,'share_bps',r.share_bps)
    ORDER BY r.performer_ordinal) FROM service_line_performer_change_rows r
    WHERE r.company_id=c.company_id AND r.business_id=c.business_id AND r.change_id=c.id AND r.side=${which})`;
}
// شاشة سجل تغيير منفّذي سطر محفوظ لمن يملك read:service-sessions:branch؛ السبب وهوية الملغي هنا فقط (D-7).
export function serviceLinePerformerChangesStatement(scope: ServiceLinePerformerChangesScope, query: ServiceLinePerformerChangesQuery) {
  const cursor = decode(scope, query);
  const older = cursor === null ? sql`true` : sql`c.revision<${cursor.revision}`;
  return sql`WITH scoped AS (
    SELECT l.company_id,l.business_id,l.id FROM service_lines l
    JOIN service_sessions s ON s.company_id=l.company_id AND s.business_id=l.business_id AND s.id=l.session_id
    WHERE l.company_id=${scope.companyId} AND l.business_id=${scope.businessId} AND l.id=${scope.lineId}
      AND l.session_id=${scope.sessionId} AND s.branch_id=${scope.branchId})
    SELECT hist.revision,${changedAt} AS changed_at,hist.reason,hist.changer_name_ar,hist.changer_name_en,
      hist.changer_role,hist.changer_role_is_system,hist.changer_role_name_ar,hist.changer_role_name_en,
      hist.before_side,hist.after_side
    FROM scoped LEFT JOIN LATERAL (
      SELECT c.revision,c.changed_at,c.reason,c.changer_name_ar,c.changer_name_en,c.changer_role,
        c.changer_role_is_system,c.changer_role_name_ar,c.changer_role_name_en,
        ${side('BEFORE')} AS before_side,${side('AFTER')} AS after_side
      FROM service_line_performer_changes c
      WHERE c.company_id=scoped.company_id AND c.business_id=scoped.business_id AND c.line_id=scoped.id AND ${older}
      ORDER BY c.revision DESC LIMIT ${query.limit + 1}
    ) hist ON true ORDER BY hist.revision DESC NULLS LAST`;
}
function snapshot(row: ChangeRow) {
  return { nameAr: row.changer_name_ar, nameEn: row.changer_name_en, role: row.changer_role, roleIsSystem: row.changer_role_is_system,
    roleNameAr: row.changer_role_name_ar, roleNameEn: row.changer_role_name_en };
}
function toItem(row: ChangeRow) {
  return { revision: row.revision, changed_at: row.changed_at, reason: row.reason,
    changer_label_ar: editorLabel('ar', snapshot(row)), changer_label_en: editorLabel('en', snapshot(row)),
    before: row.before_side, after: row.after_side };
}
export class ServiceLinePerformerChangeHistoryQuery {
  constructor(private readonly db: TenantWrappers, private readonly access: SessionDayAccess) {}
  async execute(scope: ServiceLinePerformerChangesScope, input: ServiceLinePerformerChangesQuery): Promise<ServiceLinePerformerChangesPage> {
    const query = serviceLinePerformerChangesQuery.parse(input);
    const statement = serviceLinePerformerChangesStatement(scope, query);
    return this.db.withTenant(scope.companyId, async (tx) => {
      if (!await this.access.place(tx, scope)) throw new SessionDayReadError('FORBIDDEN');
      const access = await this.access.read(tx, scope);
      if (access !== 'ALLOWED') throw new SessionDayReadError(access === 'DENIED' ? 'FORBIDDEN' : 'FEATURE_DISABLED');
      const rows = await tx.execute<ChangeRow>(statement);
      // صفر صفوف: السطر خارج النطاق؛ وسطر بلا تغيير يرجع صفحة واحدة بقيم NULL، وهي صفحة فاضية مش رفض.
      if (rows.length === 0) throw new SessionDayReadError('FORBIDDEN');
      const present = rows.filter((row) => row.revision !== null);
      const items = present.slice(0, query.limit).map(toItem);
      const last = items[items.length - 1];
      return serviceLinePerformerChangesPage.parse({ items, next_cursor: present.length > query.limit && last !== undefined
        ? Buffer.from(JSON.stringify({ ...cursorScope(scope), revision: last.revision })).toString('base64url') : null });
    }, { userId: scope.userId });
  }
}
