import { createHash } from 'node:crypto';

/**
 * بيحسب hash لمعرّف تثبيت التطبيق داخل شركة واحدة.
 * القاعدة: الـ tuple بيتكوّن من وسم النطاق والشركة ومعرّف التثبيت بحروف صغيرة، فمعرّف واحد في شركتين
 * بيطلع hash مختلف والمعرّف الخام ما بيخرجش من الدالة دي.
 *
 * @param companyId   الشركة اللي التثبيت متسجل فيها
 * @param installationId معرّف التثبيت العشوائي من المتصفح
 * @returns hash بـ 32 بايت (SHA-256)
 */
export function installationHash(companyId: string, installationId: string): Buffer {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'pospay.push.installation.v1',
        companyId.toLowerCase(),
        installationId.toLowerCase(),
      ]),
    )
    .digest();
}

/**
 * بيحسب hash لعنوان نقطة الدفع.
 * القاعدة: العنوان بيتخزّن مشفّراً بــ SHA-256 عشان نعرف إنEndpoint تغيّر من غير ما نخزّن العنوان نفسه.
 *
 * @param endpoint عنوان نقطة الدفع كما أرسله المتصفح
 * @returns hash بـ 32 بايت (SHA-256)
 */
export function endpointHash(endpoint: string): Buffer {
  return createHash('sha256').update(endpoint, 'utf8').digest();
}

/**
 * بيعمل المرجع الثابت للمشترك.
 * القاعدة: نفس الشخص في كل شركاته يطلع له نفس المرجع، والحدود الدنيا هي hash مش رجوع لاسم.
 *
 * @param userId معرّف المستخدم العام
 * @returns 64 حرف hex (SHA-256)
 */
export function subscriberRef(userId: string): string {
  return createHash('sha256')
    .update('pospay.push.subscriber.v1|' + userId.toLowerCase(), 'utf8')
    .digest('hex');
}

/**
 * بيحسب معرّف مفتاح VAPID.
 * القاعدة: أول 16 حرف hex من hash المفتاح العام، فالمفتاح بيتعرف عليه من غير ما نخزّنه.
 *
 * @param publicKey المفتاح العام base64url كما هو في الإعداد
 * @returns 16 حرف hex
 */
export function vapidKeyId(publicKey: string): string {
  return createHash('sha256').update(publicKey, 'utf8').digest('hex').slice(0, 16);
}
