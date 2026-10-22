import { z } from 'zod';

import { attendanceInstallationSignal } from './staff/unbind-passkey.js';

// المضيفون المسموح لاشتراكات الدفع: قائمة ثابتة في الكود، والتغيير لها تغيير كود (ADR-0052 §3).
const PUSH_ENDPOINT_HOSTS: readonly string[] = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
];

/** قواعد مضيف نقطة الدفع: ثلاثة مضيفين ثابتين ولاحقة نافذة ويندوز. */
export const PUSH_ENDPOINT_HOST_RULES = {
  hosts: PUSH_ENDPOINT_HOSTS,
  suffix: '.notify.windows.com',
} as const;

/**
 * يقرر إن كان المضيف واحد من مواقع الدفع المسموحة.
 *
 * @param host مضيف الـ endpoint بعد التحليل
 * @returns true للمضيف المسموح فقط
 */
export function isAllowedPushHost(host: string): boolean {
  if (PUSH_ENDPOINT_HOST_RULES.hosts.includes(host)) return true;
  const suffix = PUSH_ENDPOINT_HOST_RULES.suffix;
  return host.length > suffix.length && host.endsWith(suffix);
}

// نقطة الدفع: https ومضيف من حروف صغيرة وأرقام وشرطات ونقاط، وبعده path أو query اختياري من غير مسافات
// ولا fragment؛ الباقي ثابت فالهاش واحد لكل وجهة.
const ENDPOINT_PATTERN = /^https:\/\/([a-z0-9.-]+)(?:[/?][^\s#]*)?$/;

// أربع مجموعات أرقام بنقط: عنوان IP مش مضيف.
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

// محرف التحكم بيعدّي من فئات زي \S وبعدين عمود النص في الداتابيز بيرفضه — فبنرفضه هنا.
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * يقرر إن كان endpoint نقطة دفع مسموحة: https بمضيف من حروف صغيرة وأرقام وشرطات ونقاط،
 * بلا مستخدم ولا كلمة مرور ولا منفذ، ومضيف اسم لا عنوان IP، ومن قائمة المواقع المسموحة.
 *
 * @param value الـ endpoint كما أرسله المتصفح
 * @returns true لو هو نقطة دفع مسموحة
 */
export function isAllowedPushEndpoint(value: string): boolean {
  if (value.length === 0 || value.length > 2048) return false;
  if (hasControlCharacter(value)) return false;
  const match = ENDPOINT_PATTERN.exec(value);
  // المطابقة لازم تغطي النص كله: `$` في جافاسكربت بتقبل سطر أخير، فالمقارنة نفسها هي الضمان.
  if (match === null || match[0] !== value) return false;
  const host = match[1] ?? '';
  if (host.startsWith('.') || host.endsWith('.') || host.startsWith('-') || host.endsWith('-'))
    return false;
  if (host.includes('..')) return false;
  if (IPV4_PATTERN.test(host)) return false;
  return isAllowedPushHost(host);
}

export const pushEndpoint = z
  .string()
  .max(2048)
  .refine(isAllowedPushEndpoint, { message: 'push endpoint is not an allowed push service' })
  .meta({ id: 'PushEndpoint' });

export const pushSubscriptionInput = z
  .strictObject({
    installation_id: attendanceInstallationSignal.shape.installation_id,
    vapid_key_id: z.string().regex(/^[0-9a-f]{16}$/),
    delivery_token: z.uuid({ version: 'v4' }).toLowerCase(),
    subscription: z.strictObject({
      endpoint: pushEndpoint,
      // المتصفح بيبعت expirationTime مع كل اشتراك (غالبًا null)؛ السيرفر بيقراه وبيتجاهله.
      expirationTime: z.number().nullable().optional(),
      keys: z.strictObject({
        p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
        auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
      }),
    }),
    locale: z.enum(['ar', 'en']),
  })
  .meta({ id: 'PushSubscriptionInput' });

export const pushRevokeInput = z
  .strictObject({ installation_id: attendanceInstallationSignal.shape.installation_id })
  .meta({ id: 'PushRevokeInput' });

export const pushConfig = z
  .strictObject({
    vapid_public_key: z.string().min(1).max(256),
    vapid_key_id: z.string().regex(/^[0-9a-f]{16}$/),
    subscriber_ref: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .meta({ id: 'PushConfig' });

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInput>;
export type PushRevokeInput = z.infer<typeof pushRevokeInput>;
export type PushConfig = z.infer<typeof pushConfig>;
