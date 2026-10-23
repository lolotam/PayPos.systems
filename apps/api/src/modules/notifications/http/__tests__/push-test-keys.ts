import { createECDH, randomBytes } from 'node:crypto';

// مفتاح عام حقيقي من زوج مفاتيح P-256: نقطة على المنحنى، زي ما المتصفح بيطلبه.
export function validP256dh(): string {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return ecdh.getPublicKey().toString('base64url');
}

// مفتاح مصادقة 16 بايت، زي ما المتصفح بيبعته مع الاشتراك.
export function validAuth(): string {
  return randomBytes(16).toString('base64url');
}
