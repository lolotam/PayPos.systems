/** أبجدية كود المطابقة: نفس أبجدية كود الربط، من غير الحروف المتشابهة (0/O و1/I/L) — 31 حرف. */
export const DEVICE_CHECK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SECOND_SEED = 0x9e3779b9;
const ALPHABET_SIZE = DEVICE_CHECK_CODE_ALPHABET.length;
const PAIR_SIZE = ALPHABET_SIZE * ALPHABET_SIZE;

function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

// خلط إضافي (avalanche) عشان التغيّر الصغير في آخر الـ id يغيّر الـ hash كله، لا أوله بس.
function avalanche(hash: number): number {
  let mixed = hash >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x85ebca6b) >>> 0;
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 0xc2b2ae35) >>> 0;
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function twoLetters(hash: number): string {
  const pair = hash % PAIR_SIZE;
  const high = Math.floor(pair / ALPHABET_SIZE);
  const low = pair % ALPHABET_SIZE;
  return `${DEVICE_CHECK_CODE_ALPHABET[high]}${DEVICE_CHECK_CODE_ALPHABET[low]}`;
}

/**
 * بيحسب كود المطابقة لجهاز من معرّفه وحده: 4 حروف من هاش الـ id كامل.
 * القاعدة: الكود دالة ثابتة في الـ id من غير ملح ولا قائمة، فنفس الجهاز بياخد نفس الكود
 * في رد التسجيل وفي قائمة الأدمن وعلى شاشة الانتظار، ومن غير ما نحتاج عمود في الداتابيز.
 * الـ id هو UUID v7 مرتّب بالوقت، فالهاش بيغطي كل حروفه مش بادئة الوقت بس.
 *
 * @param deviceId معرّف الجهاز (UUID v7) — بيتعمل له trim وlower-case قبل الحساب
 * @returns كود من 4 حروف من DEVICE_CHECK_CODE_ALPHABET
 */
export function computeDeviceCheckCode(deviceId: string): string {
  const text = deviceId.trim().toLowerCase();
  const first = avalanche(fnv1a(text, FNV_OFFSET));
  const second = avalanche(fnv1a(text, (FNV_OFFSET ^ SECOND_SEED) >>> 0));
  return `${twoLetters(first)}${twoLetters(second)}`;
}
