import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

type PackageTypeRow = {
  id: string;
  name_en: string;
  name_ar: string | null;
  price: string;
  validity_days: number;
  revision: number;
};
type ComponentRow = { service_id: string; sessions: number; position: number };

export async function readPackageTypeForSale(
  tx: Tx,
  companyId: string,
  businessId: string,
  packageTypeId: string,
) {
  // النسخة العاملة من apps/api/src/modules/catalog/persistence/package-type-sale.reader.ts لقفل تعريف البيع (FR-018b).
  const types =
    await tx.execute<PackageTypeRow>(sql`SELECT id,name_en,name_ar,price::text,validity_days,revision FROM package_types
    WHERE company_id=${companyId} AND business_id=${businessId} AND id=${packageTypeId} FOR SHARE`);
  const type = types[0];
  if (type === undefined) return null;
  const components =
    await tx.execute<ComponentRow>(sql`SELECT service_id,sessions,position FROM package_type_components
    WHERE company_id=${companyId} AND business_id=${businessId} AND package_type_id=${packageTypeId} ORDER BY position`);
  return {
    id: type.id,
    name_en: type.name_en,
    name_ar: type.name_ar,
    price: type.price,
    validity_days: type.validity_days,
    revision: type.revision,
    components: components.map((row) => ({
      service_id: row.service_id,
      sessions: row.sessions,
      position: row.position,
    })),
  };
}
