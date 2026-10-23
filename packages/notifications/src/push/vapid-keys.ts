import { createECDH } from 'node:crypto';

/**
 * يولّد زوج مفاتيح VAPID جديد للتوقيع.
 * القاعدة: زوج واحد للمنصة كلها بيتولّد مرة واحدة بأمر المشغّل؛ المفتاح العام 65 بايت (87 حرف base64url)
 * والمفتاح الخاص 32 بايت (43 حرف base64url)، والمفتاح بيطبع في الطرفية بس وما بيتكتبش على القرص.
 *
 * @returns المفتاح العام والمفتاح الخاص بصيغة base64url
 */
export function generateVapidKeyPair(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const privateKey = ecdh.getPrivateKey();
  // المفتاح الخاص لازم يطلع 32 بايت بالظبط؛ أي نقص بيتعمّى من الشمال بأصفار.
  const padded =
    privateKey.length >= 32
      ? privateKey
      : Buffer.concat([Buffer.alloc(32 - privateKey.length), privateKey]);
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: padded.toString('base64url'),
  };
}
