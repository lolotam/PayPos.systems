import { businessIdentity } from '@pospay/contracts';
import type { Tx } from '@pospay/db';

export const BUSINESS_IDENTITY_READER = Symbol('BUSINESS_IDENTITY_READER');

/** منفذ القراءة بجوار الاستعلام حتى يعاد استخدام readBusinessIdentity من غير استيراد persistence. */
export interface BusinessIdentityReader {
  /** بيرجع الأسماء والشعار المخزنين، أو ثلاثة nulls لو مفيش صف، من غير ما ينشئ صف. */
  read(
    tx: Tx,
    companyId: string,
    businessId: string,
  ): Promise<{
    official_name_ar: string | null;
    official_name_en: string | null;
    logo_file_id: string | null;
  }>;
}

export async function businessIdentityQuery(
  tx: Tx,
  companyId: string,
  businessId: string,
  reader: BusinessIdentityReader,
) {
  // شاشة هوية النشاط
  return businessIdentity.parse(await reader.read(tx, companyId, businessId));
}
