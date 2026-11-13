import {
  deviceDiscountProposalCursor,
  deviceDiscountProposalList,
  deviceDiscountProposalQuery,
  type DeviceDiscountProposalCursor,
  type DeviceDiscountProposalList,
  type DeviceDiscountProposalQuery,
} from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { editorLabel } from '@pospay/i18n';
import { sql } from 'drizzle-orm';
import { SessionDayReadError } from './branch-day-service-sessions.query.ts';
import {
  expiresAt,
  requesterSnapshot,
  requestedAt,
} from './pending-discount-proposals.query.ts';

/** جهاز الفرع الذي تقرأ قائمته: الشركة والجهاز والفرع، بلا مستخدم ولا جلسة. */
export interface DeviceProposalScope {
  companyId: string;
  deviceId: string;
  branchId: string;
}

/** تثبيت نشاط الجهاز المقترن قبل قراءة قائمة طلبات الفرع. */
export interface DeviceProposalScopeAccess {
  /**
   * يعيد نشاط الجهاز المقترن في الشركة.
   *
   * @param tx معاملة القراءة
   * @param scope الشركة والجهاز والفرع
   * @returns معرّف النشاط، أو null لجهاز غير فعال أو من فرع آخر
   */
  businessOf(tx: Tx, scope: DeviceProposalScope): Promise<string | null>;
}

interface DeviceProposalReadScope extends DeviceProposalScope {
  businessId: string;
}

type DeviceRow = {
  id: string;
  request_id: string;
  kind: string;
  service_name_en: string;
  service_name_ar: string | null;
  list_price: string;
  price: string;
  discount: string;
  net: string;
  effective_bps: number;
  terms_hash: string;
  customer_first_name: string;
  requested_at: string;
  expires_at: string;
  requester_first_name_ar: string | null;
  requester_first_name_en: string | null;
  requester_role: string;
  requester_role_is_system: boolean;
  requester_role_name_ar: string | null;
  requester_role_name_en: string;
  line_id: string | null;
  base_revision: number | null;
  base_price: string | null;
  base_discount: string | null;
  base_net: string | null;
};

function decodeDeviceCursor(
  scope: DeviceProposalScope,
  query: DeviceDiscountProposalQuery,
): DeviceDiscountProposalCursor | null {
  if (query.cursor === undefined) return null;
  try {
    const bytes = Buffer.from(query.cursor, 'base64url');
    if (bytes.toString('base64url') !== query.cursor) throw new Error();
    const cursor = deviceDiscountProposalCursor.parse(JSON.parse(bytes.toString('utf8')));
    if (cursor.company === scope.companyId && cursor.branch === scope.branchId) return cursor;
  } catch { /* بيانات المؤشر لا تدخل التشخيصات. */ }
  throw new SessionDayReadError('VALIDATION_FAILED');
}

// شاشة موافقة الجهاز: طلبات الفرع المعلّقة الحيّة فقط، بلا هاتف ولا مؤدّين.
export function deviceDiscountProposalsStatement(
  scope: DeviceProposalReadScope,
  query: DeviceDiscountProposalQuery,
  now: Date,
) {
  const cursor = decodeDeviceCursor(scope, query);
  const before = cursor === null
    ? sql``
    : sql`AND (d.requested_at,d.id)<(${cursor.at}::text::timestamptz,${cursor.id}::uuid)`;
  return sql`SELECT d.id,d.request_id,d.kind,d.service_name_en,d.service_name_ar,
    d.terms->>'list_price' AS list_price,d.terms->>'price' AS price,d.terms->>'discount' AS discount,d.terms->>'net' AS net,
    d.effective_bps,d.terms_hash,d.requester_first_name_ar,d.requester_first_name_en,d.requester_role,d.requester_role_is_system,
    d.requester_role_name_ar,d.requester_role_name_en,d.customer_first_name,
    ${requestedAt} AS requested_at,${expiresAt} AS expires_at,
    d.line_id,d.base_revision,d.base_price::text AS base_price,d.base_discount::text AS base_discount,d.base_net::text AS base_net
    FROM discount_proposals d
    WHERE d.company_id=${scope.companyId} AND d.business_id=${scope.businessId} AND d.branch_id=${scope.branchId}
      AND d.status='PENDING' AND d.expires_at > ${now.toISOString()}::timestamptz ${before}
    ORDER BY d.requested_at DESC NULLS LAST,d.id DESC NULLS LAST LIMIT ${query.limit + 1}`;
}

function toDeviceItem(row: DeviceRow) {
  const snapshot = requesterSnapshot(row);
  const common = {
    id: row.id,
    request_id: row.request_id,
    service_name_en: row.service_name_en,
    service_name_ar: row.service_name_ar,
    list_price: row.list_price,
    price: row.price,
    discount: row.discount,
    net: row.net,
    effective_bps: row.effective_bps,
    requester_first_name_en: editorLabel('en', snapshot),
    requester_first_name_ar: editorLabel('ar', snapshot),
    customer_first_name: row.customer_first_name,
    requested_at: row.requested_at,
    expires_at: row.expires_at,
    terms_hash: row.terms_hash,
  };
  if (row.kind !== 'EDIT') return { kind: 'RECORD' as const, ...common };
  if (row.line_id === null || row.base_revision === null || row.base_price === null ||
    row.base_discount === null || row.base_net === null) {
    throw new SessionDayReadError('VALIDATION_FAILED');
  }
  return {
    kind: 'EDIT' as const,
    ...common,
    line_id: row.line_id,
    base_revision: row.base_revision,
    base_price: row.base_price,
    base_discount: row.base_discount,
    base_net: row.base_net,
  };
}

export class DeviceDiscountProposalsQuery {
  constructor(
    private readonly db: TenantWrappers,
    private readonly clock: { now(): Date },
    private readonly access: DeviceProposalScopeAccess,
  ) {}

  async execute(scope: DeviceProposalScope, input: unknown): Promise<DeviceDiscountProposalList> {
    const query = deviceDiscountProposalQuery.parse(input);
    decodeDeviceCursor(scope, query);
    return this.db.withTenant(scope.companyId, async (tx) => {
      const businessId = await this.access.businessOf(tx, scope);
      if (businessId === null) throw new SessionDayReadError('FORBIDDEN');
      const now = this.clock.now();
      const rows = await tx.execute<DeviceRow>(
        deviceDiscountProposalsStatement({ ...scope, businessId }, query, now),
      );
      const items = rows.slice(0, query.limit).map(toDeviceItem);
      const last = rows[query.limit - 1];
      return deviceDiscountProposalList.parse({
        items,
        next_cursor: rows.length > query.limit && last !== undefined
          ? Buffer.from(JSON.stringify({
            v: 1,
            company: scope.companyId,
            branch: scope.branchId,
            at: last.requested_at,
            id: last.id,
          })).toString('base64url')
          : null,
      });
    });
  }
}
