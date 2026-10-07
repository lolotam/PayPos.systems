import { hkdfSync } from 'node:crypto';

/** يشتق مفتاح كروت الحضور داخل حدّ الهوية كي لا يصل سر المصادقة إلى وحدة الموظفين.
 *
 * @param authSecret سر المصادقة الثابت الذي يحتفظ به جذر التركيب فقط
 * @returns مفتاح كروت مستقل بطول ٣٢ بايت؛ تدوير الأصل يستلزم إعادة إصدار الكروت
 */
export function deriveEmployeeCardKey(authSecret: string): Buffer {
  if (authSecret.length < 32) throw new Error('CARD_KEY_UNAVAILABLE');
  return Buffer.from(
    hkdfSync(
      'sha256',
      authSecret,
      'pospay:employee-card:hkdf-salt:v1',
      'pospay:employee-card:key:v1',
      32,
    ),
  );
}
