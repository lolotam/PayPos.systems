import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { country } from '@pospay/contracts';

// قارئ دولة النشاط لكل مستهلك عبر بوابته (073 D-2): القيمة المخزّنة قبل هذا التسليم أو المشوّهة تُقرأ «غير محددة»
// بسكيما العقود نفسها، فما بيوصلش JSON خام غير معروف لأي مستهلك، والنشاط الغائب يعني null مش قيمة.
export function businessCountryStatement(companyId: string, businessId: string) {
  return sql`SELECT settings FROM businesses WHERE company_id=${companyId} AND id=${businessId}`;
}

/**
 * بيقرأ دولة النشاط من إعداداته على transaction المستدعي: `null` يعني النشاط مش مرئي لشركة المستدعي،
 * و`{ country: null }` يعني النشاط مرئي لكن الدولته مش متحددة أو القيمة المخزّنة مش من الرموز الست.
 *
 * @param tx         transaction المستدعي (مع withTenant أو قارئ داخلي)
 * @param companyId  الشركة مالكة النشاط
 * @param businessId النشاط المطلوب
 * @returns `{ country }` بالرمز الصالح أو `null`، و`null` لو النشاط نفسه غير موجود
 */
export async function businessCountry(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<{ readonly country: string | null } | null> {
  const [row] = await tx.execute<{ settings: Record<string, unknown> | null }>(
    businessCountryStatement(companyId, businessId),
  );
  if (row === undefined) return null;
  const value = row.settings?.['country'];
  return { country: country.safeParse(value).success ? (value as string) : null };
}
