import { ECDH } from 'node:crypto';

// المفتاح العام للمتصفح: 65 بايت أولها 0x04، وbase64url من غير padding (87 حرف).
const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/;

// مفتاح المصادقة: 16 بايت، وbase64url من غير padding (22 حرف).
const AUTH_KEY = /^[A-Za-z0-9_-]{22}$/;

/**
 * بيتحقق إن مفتاحي الاشتراك شكلهم صح: p256dh نقطة P-256 على المنحنى، وauth 16 بايت.
 * القاعدة: التشفير بيتبني على دول بعدين، فمفتاح مش على المنحنى أو مفتاح مصادقة بطول غلط لازم
 * يترفض قبل ما يتخزن، مش وقت الإرسال.
 *
 * @param p256dh المفتاح العام للمتصفح بصيغة base64url
 * @param auth   مفتاح المصادقة بصيغة base64url
 * @returns true بس لو المفتاحين دول صحّين
 */
export function isValidSubscriptionKeys(p256dh: string, auth: string): boolean {
  if (!PUBLIC_KEY.test(p256dh) || !AUTH_KEY.test(auth)) return false;
  const point = Buffer.from(p256dh, 'base64url');
  if (point.length !== 65 || point[0] !== 0x04) return false;
  try {
    // النقطة لازم تكون على منحنى P-256: أي نص تاني التشفير بيفشل بيه وقت الإرسال.
    ECDH.convertKey(point, 'prime256v1');
  } catch {
    return false;
  }
  return Buffer.from(auth, 'base64url').length === 16;
}
