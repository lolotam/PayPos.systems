import { serviceLineCancellation, type ServiceLineCancellation } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { editorLabel } from '@pospay/i18n';
import { sql } from 'drizzle-orm';
import {
  SessionDayReadError,
  type SessionDayAccess,
  type SessionDayScope,
} from './branch-day-service-sessions.query.ts';

export interface ServiceLineCancellationScope extends SessionDayScope {
  sessionId: string;
  lineId: string;
}
type CancelRow = {
  previous_revision: number | null;
  previous_price: string | null;
  previous_discount: string | null;
  previous_net: string | null;
  cancelled_at: string | null;
  reason: string | null;
  canceller_name_ar: string | null;
  canceller_name_en: string | null;
  canceller_role: string | null;
  canceller_role_is_system: boolean | null;
  canceller_role_name_ar: string | null;
  canceller_role_name_en: string | null;
};
const cancelledAt = sql`to_char(c.cancelled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// سجل إلغاء سطر في قائمة اليوم للمدير الذي يملك read:service-sessions:branch. السبب وهوية الملغي هنا فقط.
export function serviceLineCancellationStatement(scope: ServiceLineCancellationScope) {
  return sql`WITH scoped AS (
    SELECT l.company_id,l.business_id,l.id FROM service_lines l
    JOIN service_sessions s ON s.company_id=l.company_id AND s.business_id=l.business_id AND s.id=l.session_id
    WHERE l.company_id=${scope.companyId} AND l.business_id=${scope.businessId} AND l.id=${scope.lineId}
      AND l.session_id=${scope.sessionId} AND s.branch_id=${scope.branchId})
    SELECT c.previous_revision,c.previous_price::text AS previous_price,c.previous_discount::text AS previous_discount,
      c.previous_net::text AS previous_net,${cancelledAt} AS cancelled_at,c.reason,
      c.canceller_name_ar,c.canceller_name_en,c.canceller_role,c.canceller_role_is_system,
      c.canceller_role_name_ar,c.canceller_role_name_en
    FROM scoped JOIN service_line_cancellations c
      ON c.company_id=scoped.company_id AND c.business_id=scoped.business_id AND c.line_id=scoped.id`;
}
function snapshot(row: CancelRow) {
  return {
    nameAr: row.canceller_name_ar,
    nameEn: row.canceller_name_en,
    role: row.canceller_role,
    roleIsSystem: row.canceller_role_is_system,
    roleNameAr: row.canceller_role_name_ar,
    roleNameEn: row.canceller_role_name_en,
  };
}
function toCancellation(row: CancelRow) {
  return {
    cancelled_at: row.cancelled_at,
    reason: row.reason,
    canceller_label_ar: editorLabel('ar', snapshot(row)),
    canceller_label_en: editorLabel('en', snapshot(row)),
    previous: {
      revision: row.previous_revision,
      price: row.previous_price,
      discount: row.previous_discount,
      net: row.previous_net,
    },
  };
}
export class ServiceLineCancellationQuery {
  constructor(
    private readonly db: TenantWrappers,
    private readonly access: SessionDayAccess,
  ) {}
  async execute(scope: ServiceLineCancellationScope): Promise<ServiceLineCancellation> {
    const statement = serviceLineCancellationStatement(scope);
    return this.db.withTenant(
      scope.companyId,
      async (tx) => {
        if (!(await this.access.place(tx, scope))) throw new SessionDayReadError('FORBIDDEN');
        const access = await this.access.read(tx, scope);
        if (access !== 'ALLOWED')
          throw new SessionDayReadError(access === 'DENIED' ? 'FORBIDDEN' : 'FEATURE_DISABLED');
        const rows = await tx.execute<CancelRow>(statement);
        // صفر صفوف: السطر خارج النطاق أو لسه متلغاش، والاتنين نفس 403.
        const row = rows.length === 1 ? rows[0] : undefined;
        if (!row) throw new SessionDayReadError('FORBIDDEN');
        return serviceLineCancellation.parse(toCancellation(row));
      },
      { userId: scope.userId },
    );
  }
}
