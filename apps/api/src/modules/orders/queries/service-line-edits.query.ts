import { serviceLineEditsCursor, serviceLineEditsPage, serviceLineEditsQuery,
  type ServiceLineEditsPage, type ServiceLineEditsQuery } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { editorLabel } from '@pospay/i18n';
import { sql } from 'drizzle-orm';
import { SessionDayReadError, type SessionDayAccess } from './branch-day-service-sessions.query.ts';
import {
  decodeLineHistoryCursor,
  encodeLineHistoryCursor,
  type ServiceLineHistoryScope,
} from './service-line-history-cursor.ts';

export type ServiceLineEditsScope = ServiceLineHistoryScope;
type EditRow = {
  revision: number | null;
  previous_price: string | null; previous_discount: string | null; previous_net: string | null;
  new_price: string | null; new_discount: string | null; new_net: string | null;
  changed_at: string | null; reason: string | null;
  editor_name_ar: string | null; editor_name_en: string | null; editor_role: string | null;
  editor_role_is_system: boolean | null; editor_role_name_ar: string | null; editor_role_name_en: string | null;
};
const changedAt = sql`to_char(hist.changed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// شاشة سجل تعديل سعر السطر لمن يملك read:service-sessions:branch. السبب هنا فقط، والجملة تثبت السطر للجلسة والفرع.
export function serviceLineEditsStatement(scope: ServiceLineEditsScope, query: ServiceLineEditsQuery) {
  const cursor = decodeLineHistoryCursor(scope, query.cursor, (value) => serviceLineEditsCursor.parse(value));
  const before = cursor === null ? sql`true` : sql`e.revision<${cursor.revision}`;
  return sql`WITH scoped AS (
    SELECT l.company_id,l.business_id,l.id FROM service_lines l
    JOIN service_sessions s ON s.company_id=l.company_id AND s.business_id=l.business_id AND s.id=l.session_id
    WHERE l.company_id=${scope.companyId} AND l.business_id=${scope.businessId} AND l.id=${scope.lineId}
      AND l.session_id=${scope.sessionId} AND s.branch_id=${scope.branchId})
    SELECT hist.revision,hist.previous_price::text AS previous_price,hist.previous_discount::text AS previous_discount,
      hist.previous_net::text AS previous_net,hist.new_price::text AS new_price,hist.new_discount::text AS new_discount,
      hist.new_net::text AS new_net,${changedAt} AS changed_at,hist.reason,hist.editor_name_ar,hist.editor_name_en,
      hist.editor_role,hist.editor_role_is_system,hist.editor_role_name_ar,hist.editor_role_name_en
    FROM scoped LEFT JOIN LATERAL (
      SELECT e.revision,e.previous_price,e.previous_discount,e.previous_net,e.new_price,e.new_discount,e.new_net,e.changed_at,
        e.reason,e.editor_name_ar,e.editor_name_en,e.editor_role,e.editor_role_is_system,e.editor_role_name_ar,e.editor_role_name_en
      FROM service_line_edits e
      WHERE e.company_id=scoped.company_id AND e.business_id=scoped.business_id AND e.line_id=scoped.id AND ${before}
      ORDER BY e.revision DESC LIMIT ${query.limit + 1}
    ) hist ON true ORDER BY hist.revision DESC NULLS LAST`;
}
function snapshot(row: EditRow) {
  return { nameAr: row.editor_name_ar, nameEn: row.editor_name_en, role: row.editor_role, roleIsSystem: row.editor_role_is_system,
    roleNameAr: row.editor_role_name_ar, roleNameEn: row.editor_role_name_en };
}
function toItem(row: EditRow) {
  return { revision: row.revision, reason: row.reason, changed_at: row.changed_at,
    previous: { price: row.previous_price, discount: row.previous_discount, net: row.previous_net },
    new: { price: row.new_price, discount: row.new_discount, net: row.new_net },
    editor_label_ar: editorLabel('ar', snapshot(row)), editor_label_en: editorLabel('en', snapshot(row)) };
}
export class ServiceLineEditHistoryQuery {
  constructor(private readonly db: TenantWrappers, private readonly access: SessionDayAccess) {}
  async execute(scope: ServiceLineEditsScope, input: ServiceLineEditsQuery): Promise<ServiceLineEditsPage> {
    const query = serviceLineEditsQuery.parse(input);
    const statement = serviceLineEditsStatement(scope, query);
    return this.db.withTenant(scope.companyId, async (tx) => {
      if (!await this.access.place(tx, scope)) throw new SessionDayReadError('FORBIDDEN');
      const access = await this.access.read(tx, scope);
      if (access !== 'ALLOWED') throw new SessionDayReadError(access === 'DENIED' ? 'FORBIDDEN' : 'FEATURE_DISABLED');
      const rows = await tx.execute<EditRow>(statement);
      if (rows.length === 0) throw new SessionDayReadError('FORBIDDEN');
      const present = rows.filter((row) => row.revision !== null);
      const items = present.slice(0, query.limit).map(toItem);
      const last = items[items.length - 1];
      return serviceLineEditsPage.parse({ items, next_cursor: present.length > query.limit && last !== undefined && last.revision !== null
        ? encodeLineHistoryCursor(scope, last.revision) : null });
    }, { userId: scope.userId });
  }
}
