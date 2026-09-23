import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// أسرار الأجهزة (ADR-0003 §4 path B) — packages/auth بس هو اللي بيعملها ويتأكد منها (CLAUDE.md §8). السر عشوائي
// 32 byte، فـ SHA-256 كفاية ومفيش داعي لـ hash بطيء زي الباسورد؛ المقارنة constant-time.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/**
 * التوكن زي ما الجهاز بيبعته: الشركة والجهاز مكتوبين فيه، والسر بيتأكد جوه الشركة دي بس.
 */
export interface DeviceToken {
  readonly companyId: string;
  readonly deviceId: string;
  readonly secret: string;
}

/**
 * سر جديد لجهاز — سر استلام أو token.
 *
 * @returns 32 byte عشوائي بـ base64url
 */
export function newDeviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * الـ hash اللي بيتخزن بدل السر.
 *
 * @param secret السر
 * @returns sha256 hex
 */
export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * بيقارن السر بالـ hash المتخزن من غير ما الوقت يكشف أي حاجة.
 *
 * @param secret السر اللي جه في الطلب
 * @param stored الـ hash المتخزن، أو null لو مفيش
 * @returns true لو مطابق
 */
export function verifyDeviceSecret(secret: string, stored: string | null): boolean {
  if (stored === null || !/^[0-9a-f]{64}$/.test(stored)) return false;
  const given = Buffer.from(hashDeviceSecret(secret), 'hex');
  return timingSafeEqual(given, Buffer.from(stored, 'hex'));
}

/**
 * التوكن اللي الجهاز بيحتفظ بيه: pd_<company>.<device>.<secret>.
 *
 * @param token الشركة والجهاز والسر
 * @returns النص اللي بيتسلم للجهاز مرة واحدة
 */
export function formatDeviceToken(token: DeviceToken): string {
  return `pd_${token.companyId}.${token.deviceId}.${token.secret}`;
}

/**
 * بيفك التوكن من غير أي داتابيز. أي شكل غلط = null — والرفض بعدها واحد في كل الحالات، فمفيش oracle.
 *
 * @param value الـ token زي ما جه
 * @returns الأجزاء، أو null
 */
export function parseDeviceToken(value: string): DeviceToken | null {
  const match = /^pd_([^.]+)\.([^.]+)\.([^.]+)$/.exec(value);
  if (match === null) return null;
  const [, companyId = '', deviceId = '', secret = ''] = match;
  if (!UUID.test(companyId) || !UUID.test(deviceId) || !SECRET.test(secret)) return null;
  return { companyId, deviceId, secret };
}
