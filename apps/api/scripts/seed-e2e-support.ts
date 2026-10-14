// نسخة الـ seed من أدوات e2e الأدمن (TOTP والكوكي والتاريخ المدني): سكربتات الـ API ما تستوردش من شجرة تطبيق تاني،
// والـ seed بيتأكد من متجه RFC 6238 قبل ما يسجّل TOTP (assertTotpVector)، زي ما اختبار الأدمن بيتأكد من نسخته.
import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function decodeBase32(secret: string): Buffer {
  const cleaned = secret.replace(/=+$/u, '').replace(/ /gu, '').toUpperCase();
  let bits = '';
  for (const char of cleaned) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error('TOTP_SECRET');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

export function totpCode(secret: string, at: Date, digits = 6, stepSeconds = 30): string {
  const counter = Math.floor(at.getTime() / 1000 / stepSeconds);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = (hmac.at(-1) ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

export async function freshTotp(secret: string): Promise<string> {
  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (remaining < 5) {
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1000));
  }
  return totpCode(secret, new Date());
}

export function joinCookies(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .filter((cookie) => cookie.includes('='))
    .join('; ');
}

export function civilDate(timeZone: string, offsetDays: number): string {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = formatted.split('-').map(Number);
  const utc = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + offsetDays));
  return utc.toISOString().slice(0, 10);
}
