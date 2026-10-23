import { ECDH } from 'node:crypto';

import { vapidKeyId } from './hashes.ts';

/** إعداد الدفع اللي الـ API شايفه: المفتاح العام ومعرّفه وجهة الاتصال. */
export interface PushApiConfiguration {
  readonly publicKey: string;
  readonly keyId: string;
  readonly subject: string;
}

// المفتاح العام لـ P-256: 65 بايت أولها 0x04، وbase64url من غير padding.
const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/;
const SUBJECT_ADDRESS = /^[^\s@]+@[^\s@]+$/;

function isValidPublicKey(value: string): boolean {
  if (!PUBLIC_KEY.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== 65 || decoded[0] !== 0x04) return false;
  try {
    // النقطة لازم تكون على منحنى P-256: أي نص تاني المتصفح بي رفضه بعد ما السيرفر يعلن إنه جاهز.
    ECDH.convertKey(decoded, 'prime256v1');
    return true;
  } catch {
    return false;
  }
}

function isValidSubject(value: string): boolean {
  if (value.startsWith('mailto:')) return SUBJECT_ADDRESS.test(value.slice('mailto:'.length));
  if (!value.startsWith('https:')) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * بيقرأ إعداد الدفع من البيئة.
 * القاعدة: الإعداد جاهز بس لو المفتاح العام وجهة الاتصال صحّين مع بعض؛ المفتاح الخاص ما بيقراش هنا أبداً
 * لأن الـ API ما يحفظش مفتاح توقيع.
 *
 * @param env بيئة العملية
 * @returns الإعداد، أو null لو ناقص أو غلط
 */
export function readPushApiConfiguration(env: NodeJS.ProcessEnv): PushApiConfiguration | null {
  const publicKey = env['VAPID_PUBLIC_KEY'];
  const subject = env['VAPID_SUBJECT'];
  if (publicKey === undefined || subject === undefined) return null;
  if (!isValidPublicKey(publicKey)) return null;
  if (!isValidSubject(subject)) return null;
  return { publicKey, keyId: vapidKeyId(publicKey), subject };
}
