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

// المضيف كما هو مكتوب في الطلب: الـ URL parser بيعيّره، فالمقارنة الحرفية هي اللي تكشف الحروف الكبيرة.
function rawAuthorityHost(value: string): string | null {
  const scheme = value.indexOf('://');
  if (scheme < 0) return null;
  const rest = value.slice(scheme + 3);
  const end = rest.search(/[/?#]/);
  const authority = end < 0 ? rest : rest.slice(0, end);
  if (authority.length === 0 || authority.includes('@')) return null;
  if (authority.startsWith('[')) return null;
  const colon = authority.lastIndexOf(':');
  if (colon < 0) return authority;
  const port = authority.slice(colon + 1);
  if (!/^\d+$/.test(port)) return null;
  return authority.slice(0, colon);
}

/**
 * يقرر إن كان endpoint نقطة دفع مسموحة: https بلا مستخدم ولا كلمة مرور ولا منفذ غير الافتراضي،
 * ومضيف اسم لا عنوان IP، وحروفه صغيرة بلا نقطة أخيرة، ومن قائمة المواقع المسموحة.
 *
 * @param value الـ endpoint كما أرسله المتصفح
 * @returns true لو هو نقطة دفع مسموحة
 */
export function isAllowedPushEndpoint(value: string): boolean {
  if (value.length === 0 || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.port !== '') return false;
  const host = url.hostname;
  if (host.startsWith('[') || host.endsWith(']')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.endsWith('.')) return false;
  const raw = rawAuthorityHost(value);
  if (raw === null || raw !== host) return false;
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
