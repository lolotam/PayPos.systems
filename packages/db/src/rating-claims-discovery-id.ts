import { createHash } from 'node:crypto';

import { createUuidV7 } from '@pospay/ids';

const DISCOVERY_NAMESPACE = 'pospay:rating-claims-discovery:0194:';

/**
 * يشتق معرّف حدث اكتشاف ثابت للشركة، فإعادة خطوة الترحيل أو تزامنها يصطدمان بنفس مفتاح الـ outbox
 * بدل قراءة محظورة على pospay_app؛ ترتيب النشر يظل على seq لا على وقت الاكتشاف الصناعي.
 *
 * @param companyId معرّف الشركة بصيغته القياسية lowercase
 * @returns UUID v7 ثابت لحدث اكتشاف طلبات التقييم الوحيد للشركة
 */
export function ratingClaimsDiscoveryEventId(companyId: string): string {
  const entropy = createHash('sha256').update(DISCOVERY_NAMESPACE).update(companyId).digest();
  return createUuidV7({
    now: () => 0,
    fillRandom: (bytes) => {
      bytes.set(entropy.subarray(0, bytes.length));
    },
  }).newId();
}
