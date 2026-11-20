import type { CommissionOverrideServiceRow } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

type Row = CommissionOverrideServiceRow;

export function commissionOverrideServicesStatement(
  companyId: string,
  businessId: string,
  query: { readonly cursor?: string | undefined; readonly limit: number },
) {
  return sql`SELECT id,name_en,name_ar,price::text,
    CASE commission_rule_kind
      WHEN 'PCT' THEN jsonb_build_object('kind',commission_rule_kind,'value',commission_pct_bps)
      WHEN 'FIXED' THEN jsonb_build_object('kind',commission_rule_kind,'value',commission_fixed_amount::text)
      ELSE jsonb_build_object('kind',commission_rule_kind) END AS rule,
    to_char(closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closed_at
    FROM services WHERE company_id=${companyId} AND business_id=${businessId}
    ${query.cursor === undefined ? sql`` : sql`AND id > ${query.cursor}`}
    ORDER BY id LIMIT ${query.limit + 1}`;
}

export async function readCommissionOverrideServices(
  tx: Tx,
  companyId: string,
  businessId: string,
  query: { readonly cursor?: string | undefined; readonly limit: number },
) {
  const rows = await tx.execute<Row>(
    commissionOverrideServicesStatement(companyId, businessId, query),
  );
  const items = rows.slice(0, query.limit);
  return { items, next_cursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null };
}
