import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { StoredBusinessIdentity } from '../domain/statement-identity.ts';

type IdentityRow = {
  official_name_ar: string | null;
  official_name_en: string | null;
  logo_file_id: string | null;
};

// نفس جملة القراءة، عشان EXPLAIN يفحص المفتاح مش نسخة تانية من الاستعلام.
export function businessIdentityReadStatement(companyId: string, businessId: string) {
  return sql`
    SELECT official_name_ar, official_name_en, logo_file_id
    FROM business_settings
    WHERE company_id = ${companyId} AND business_id = ${businessId}`;
}

// قراءة البيان ما تنشئش صف: الغياب ثلاثة nulls، وبايتات الشعار مش جزء من الهوية المخزنة.
export async function readBusinessIdentity(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<StoredBusinessIdentity> {
  const [row] = await tx.execute<IdentityRow>(businessIdentityReadStatement(companyId, businessId));
  return {
    official_name_ar: row?.official_name_ar ?? null,
    official_name_en: row?.official_name_en ?? null,
    logo_file_id: row?.logo_file_id ?? null,
  };
}
