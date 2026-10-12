import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { Service } from '@pospay/contracts';
type ServiceCommissionRule = Service['commission_rule'];

type Row = { id: string; name_en: string; name_ar: string | null; price: string; commission_rule_kind: ServiceCommissionRule['kind']; commission_pct_bps: number | null; commission_fixed_amount: string | null; counts_toward_threshold: boolean; revision: number };
function rule(row: Row): ServiceCommissionRule {
  switch (row.commission_rule_kind) {
    case 'FOLLOW_PLAN': return { kind: 'FOLLOW_PLAN' };
    case 'ZERO': return { kind: 'ZERO' };
    case 'PCT': if (row.commission_pct_bps === null) throw new Error('Invalid catalog rule'); return { kind: 'PCT', value: row.commission_pct_bps };
    case 'FIXED': if (row.commission_fixed_amount === null) throw new Error('Invalid catalog rule'); return { kind: 'FIXED', value: row.commission_fixed_amount };
    default: { const unreachable: never = row.commission_rule_kind; throw new Error(`Unsupported catalog rule ${unreachable}`); }
  }
}

export async function readSessionServices(tx: Tx, companyId: string, businessId: string, serviceIds: readonly string[], lockOnly = false) {
  if (serviceIds.length === 0 || serviceIds.length > 20) throw new RangeError('Session service batch size');
  const ids = [...new Set(serviceIds)].sort();
  const query = sql`SELECT id,name_en,name_ar,price::text,commission_rule_kind,commission_pct_bps,
    commission_fixed_amount::text,counts_toward_threshold,revision FROM services
    WHERE company_id=${companyId} AND business_id=${businessId} AND id=ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`,`)}]::uuid[]) ORDER BY id`;
  const rows = await tx.execute<Row>(lockOnly ? sql`${query} FOR SHARE` : query);
  return lockOnly ? [] : rows.map((row) => ({ id: row.id, name_en: row.name_en, name_ar: row.name_ar, price: row.price,
    rule: rule(row), counts: row.counts_toward_threshold, revision: row.revision }));
}
