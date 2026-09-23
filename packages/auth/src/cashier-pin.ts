import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// PIN الكاشير (ADR-0003 §4.2، PRD D-08) — packages/auth بس هو اللي بيعمل الـ hash ويتأكد منه (CLAUDE.md §8).
// PBKDF2-SHA256 عشان موجود في WebCrypto كمان: الـ POS هيتأكد من نفس الـ hash وهو offline (P2-T9). 4 أرقام مساحتها
// صغيرة، فالحماية الحقيقية هي القفل بعد 5 محاولات مش بطء الـ hash — والعدد مكتوب جوه الـ hash عشان نغيّره من غير ما
// نكسر القديم.
const ITERATIONS = 600_000;
const KEY_BYTES = 32;
const FORMAT = /^pbkdf2-sha256\$(\d{1,7})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;
const derive = promisify(pbkdf2);

// موظف مالوش PIN بيتقارن بالـ hash ده عشان الوقت ما يكشفش إنه مالوش: hash لقيمة عشوائية اترمت، مش سر. ثابت ومحسوب
// مسبقاً، عشان أول طلب في الـ process ما ياخدش وقت زيادة وهو بيعمله.
const PLACEHOLDER =
  'pbkdf2-sha256$600000$rpsPl_wobQjJhlnTKTOKvA$i9QxsF0PBkaW9UuPL9_uqevHAXC_OtNk92gyXjfpJ4U';

/**
 * بيعمل hash للـ PIN بملح عشوائي.
 *
 * @param pin الـ PIN زي ما الموظف كتبه — الـ use case اتأكد من شكله قبل كده
 * @returns pbkdf2-sha256$<iterations>$<salt>$<hash> بـ base64url
 */
export async function hashCashierPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(pin, salt, ITERATIONS, KEY_BYTES, 'sha256');
  return `pbkdf2-sha256$${ITERATIONS}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/**
 * بيقارن الـ PIN بالـ hash المتخزن constant-time، وبياخد نفس الوقت تقريباً لو مفيش hash خالص.
 *
 * @param pin    الـ PIN اللي جه في الطلب
 * @param stored الـ hash المتخزن، أو null لو الموظف مالوش PIN
 * @returns true لو مطابق
 */
export async function verifyCashierPin(pin: string, stored: string | null): Promise<boolean> {
  const match = FORMAT.exec(stored ?? PLACEHOLDER);
  if (match === null) return false;
  const [, iterations = '', salt = '', expected = ''] = match;
  if (Number(iterations) < 1) return false;
  const key = await derive(
    pin,
    Buffer.from(salt, 'base64url'),
    Number(iterations),
    KEY_BYTES,
    'sha256',
  );
  return timingSafeEqual(key, Buffer.from(expected, 'base64url')) && stored !== null;
}
