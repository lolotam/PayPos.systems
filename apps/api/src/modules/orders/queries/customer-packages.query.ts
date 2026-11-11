import {
  customerPackagePage,
  customerPackagesCursorData,
  customerPackagesQuery,
  type CustomerPackageListItem,
  type CustomerPackagePage,
  type CustomerPackagesCursorData,
  type CustomerPackagesQuery,
} from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

export interface CustomerPackageScope {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
  customerId: string;
}

export interface CustomerPackageReads {
  place(tx: Tx, scope: CustomerPackageScope): Promise<string | null>;
}

export class CustomerPackageReadError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'PACKAGE_NOT_FOUND') {
    super(code);
  }
}

function decodeCursor(customerId: string, raw: string | undefined): CustomerPackagesCursorData | null {
  if (raw === undefined) return null;
  try {
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw new Error();
    const cursor = customerPackagesCursorData.parse(JSON.parse(bytes.toString('utf8')));
    if (cursor.customer_id !== customerId) throw new Error();
    return cursor;
  } catch {
    throw new RangeError('CUSTOMER_PACKAGES_CURSOR_INVALID');
  }
}

function encodeCursor(scope: CustomerPackageScope, row: CustomerPackageRow): string {
  return Buffer.from(JSON.stringify({
    customer_id: scope.customerId,
    rank: row.rank,
    expires_on: row.item.expires_on,
    id: row.item.id,
  })).toString('base64url');
}

function componentProjection(): SQL {
  return sql`COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'service_id', c.service_id,
      'position', c.position,
      'name_en', c.name_en,
      'name_ar', c.name_ar,
      'sessions_total', c.sessions_total,
      'remaining', totals.remaining,
      'used', totals.used,
      'refunded', totals.refunded,
      'next_unit_value', next_slot.unit_value,
      'slot_values', totals.slot_values
    ) ORDER BY c.position)
    FROM package_components c
    CROSS JOIN LATERAL (
      SELECT sum(priced.free)::int AS remaining,
        sum(priced.used)::int AS used,
        sum(priced.refunded)::int AS refunded,
        COALESCE(jsonb_agg(jsonb_build_object(
          'unit_value', priced.unit_value::text,
          'free', priced.free,
          'used', priced.used,
          'refunded', priced.refunded
        ) ORDER BY priced.unit_value), '[]'::jsonb) AS slot_values
      FROM (
        SELECT s.unit_value,
          (count(*) FILTER (WHERE s.state='FREE'))::int AS free,
          (count(*) FILTER (WHERE s.state IN ('USED','IMPORTED_USED')))::int AS used,
          (count(*) FILTER (WHERE s.state='REFUNDED'))::int AS refunded
        FROM package_session_slots s
        WHERE s.company_id=page.company_id AND s.business_id=page.business_id
          AND s.entitlement_id=page.id AND s.component_id=c.id
        GROUP BY s.unit_value
      ) priced
    ) totals
    LEFT JOIN LATERAL (
      SELECT s.unit_value::text AS unit_value
      FROM package_session_slots s
      WHERE s.company_id=page.company_id AND s.component_id=c.id AND s.state='FREE'
      ORDER BY s.ordinal LIMIT 1
    ) next_slot ON true
    WHERE c.company_id=page.company_id AND c.business_id=page.business_id
      AND c.entitlement_id=page.id
  ), '[]'::jsonb)`;
}

// قايمة باقات العميلة في الاستقبال ومفتاح «من الباقة» بيستهلكوا نفس اللقطة والترتيب.
export function customerPackagesStatement(
  companyId: string,
  businessId: string,
  customerId: string,
  now: Date,
  timezone: string,
  after: CustomerPackagesCursorData | null,
  limit: number,
): SQL {
  const keyset = after === null
    ? sql`TRUE`
    : sql`(page.rank, page.expires_on, page.id) > (${after.rank}, ${after.expires_on}::date, ${after.id}::uuid)`;
  return sql`WITH flags AS (
    SELECT e.id, e.provenance, e.name_en, e.name_ar, e.expires_on, e.price_paid, e.refunded_amount,
      e.company_id, e.business_id,
      ((${now.toISOString()}::timestamptz AT TIME ZONE ${timezone})::date > e.expires_on) AS expired,
      NOT EXISTS (
        SELECT 1 FROM package_session_slots s
        WHERE s.company_id=e.company_id AND s.business_id=e.business_id
          AND s.entitlement_id=e.id AND s.state='FREE'
      ) AS used_up
    FROM package_entitlements e
    WHERE e.company_id=${companyId} AND e.company_id=app_company_id()
      AND e.business_id=${businessId} AND e.customer_id=${customerId}
  ), page AS (
    SELECT flags.*, CASE WHEN NOT expired AND NOT used_up THEN 0 ELSE 1 END AS rank FROM flags
  )
  SELECT jsonb_build_object(
    'id', page.id,
    'provenance', page.provenance,
    'name_en', page.name_en,
    'name_ar', page.name_ar,
    'expires_on', to_char(page.expires_on, 'YYYY-MM-DD'),
    'expired', page.expired,
    'used_up', page.used_up,
    'price_paid', page.price_paid::text,
    'refunded_amount', page.refunded_amount::text,
    'components', ${componentProjection()}
  ) AS item, page.rank
  FROM page
  WHERE ${keyset}
  ORDER BY page.rank, page.expires_on, page.id
  LIMIT ${limit + 1}`;
}

type CustomerPackageRow = {
  item: CustomerPackageListItem;
  rank: 0 | 1;
};

export class CustomerPackagesQueryHandler {
  constructor(
    private readonly db: TenantWrappers,
    private readonly reads: CustomerPackageReads,
    private readonly clock: { now(): Date },
  ) {}

  async execute(scope: CustomerPackageScope, input: CustomerPackagesQuery): Promise<CustomerPackagePage> {
    const query = customerPackagesQuery.parse(input);
    const after = decodeCursor(scope.customerId, query.cursor);
    return this.db.withTenant(scope.companyId, async (tx) => {
      const timezone = await this.reads.place(tx, scope);
      if (timezone === null) throw new CustomerPackageReadError('FORBIDDEN');
      const rows = await tx.execute<CustomerPackageRow>(customerPackagesStatement(
        scope.companyId, scope.businessId, scope.customerId, this.clock.now(), timezone, after, query.limit,
      ));
      const visible = rows.slice(0, query.limit);
      const last = visible[visible.length - 1];
      return customerPackagePage.parse({
        items: visible.map((row) => row.item),
        next_cursor: rows.length > query.limit && last !== undefined ? encodeCursor(scope, last) : null,
      });
    }, { userId: scope.userId });
  }
}
