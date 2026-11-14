import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

type Row = {
  id: string;
  name_en: string;
  name_ar: string | null;
  price: string;
  revision: number;
};

// النسخة العاملة من apps/api/src/modules/catalog/persistence/session-services.reader.ts للبيع تحت FOR SHARE.
export async function lockSessionServicesForSale(
  tx: Tx,
  companyId: string,
  businessId: string,
  serviceIds: readonly string[],
) {
  if (serviceIds.length === 0 || serviceIds.length > 20) {
    throw new RangeError('Session service batch size');
  }
  const ids = [...new Set(serviceIds)].sort();
  const rows = await tx.execute<Row>(sql`SELECT id,name_en,name_ar,price::text,commission_rule_kind,commission_pct_bps,
    commission_fixed_amount::text,counts_toward_threshold,revision FROM services
    WHERE company_id=${companyId} AND business_id=${businessId} AND id=ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`,`)}]::uuid[]) ORDER BY id FOR SHARE`);
  return rows.map((row) => ({
    id: row.id,
    name_en: row.name_en,
    name_ar: row.name_ar,
    price: row.price,
    revision: row.revision,
  }));
}
