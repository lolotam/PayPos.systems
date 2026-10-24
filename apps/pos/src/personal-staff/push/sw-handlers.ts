import type { PushRecordStore } from './push-record';

/** عنوان الإشعار المحايد: المتصفح لازم يعرض إشعار لكل push، فبنعرض واحد من غير نص. */
const NEUTRAL_TITLE = 'PosPay';
/** صفحة الموظف هي الوجهة الافتراضية للإشعار. */
const FALLBACK_URL = '/personal';

/** جسم الإشعار كما بيشوفه المتصفح. */
export interface SwNotificationOptions {
  body?: string;
  tag?: string;
  lang?: string;
  dir?: 'ltr' | 'rtl';
  data?: { url: string };
}

/** تسجيل الـ service worker بالجزء اللي handlers محتاجاه بس. */
export interface SwRegistration {
  showNotification(title: string, options?: SwNotificationOptions): Promise<void>;
}

/** نافذة مفتوحة من نفس الأصل. */
export interface SwClient {
  url: string;
  focus(): Promise<SwClient>;
  navigate?(url: string): Promise<SwClient>;
}

/** مجموعة النوافذ المفتوحة. */
export interface SwClients {
  matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly SwClient[]>;
  openWindow(url: string): Promise<SwClient | null>;
}

/** الإشعار المعروض على الشاشة. */
export interface SwNotification {
  close(): void;
  data?: { url?: string } | null;
}

/** الحمولة اللي بتبعتها الخادم: نص الإشعار ورابطه وتوكن التسليم. */
export interface SwPushPayload {
  v: number;
  title: string;
  body: string;
  tag: string;
  url: string;
  lang: string;
  t: string;
}

/**
 * بيتأكد إن الرابط مسار داخلي: مسار بيبدأ بشرطة مائلة واحدة، مش رابط تاني ولا بروتوكول.
 *
 * @param value الرابط كما جاي في الحمولة
 * @returns المسار الآمن أو صفحة الموظف
 */
export function safeUrl(value: string | undefined): string {
  if (typeof value !== 'string') return FALLBACK_URL;
  if (!value.startsWith('/')) return FALLBACK_URL;
  if (value.startsWith('//')) return FALLBACK_URL;
  return value;
}

function parsePayload(data: string | null): SwPushPayload | null {
  if (data === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  if (value.v !== 1) return null;
  if (typeof value.title !== 'string') return null;
  if (typeof value.body !== 'string') return null;
  if (typeof value.tag !== 'string') return null;
  if (typeof value.url !== 'string') return null;
  if (typeof value.lang !== 'string') return null;
  if (typeof value.t !== 'string') return null;
  return {
    v: 1,
    title: value.title,
    body: value.body,
    tag: value.tag,
    url: value.url,
    lang: value.lang,
    t: value.t,
  };
}

async function showNeutral(registration: SwRegistration): Promise<void> {
  await registration.showNotification(NEUTRAL_TITLE, { data: { url: FALLBACK_URL } });
}

async function readRecord(store: PushRecordStore) {
  try {
    return await store.read();
  } catch {
    return null;
  }
}

/**
 * هاندلر الـ push: بيعرض نص الإشعار بس لو الحمولة سليمة والتوكن مطابق والسجل مش معلّق.
 * أي حالة تانية بتعرض إشعار محايد من غير نص (ADR-0052 §7).
 *
 * @param input الحمولة والتسجيل والمخزن المحلي
 */
export async function handlePush(input: {
  data: string | null;
  registration: SwRegistration;
  store: PushRecordStore;
}): Promise<void> {
  const payload = parsePayload(input.data);
  if (payload === null) {
    await showNeutral(input.registration);
    return;
  }
  const record = await readRecord(input.store);
  if (record === null || record.suspended || payload.t !== record.token) {
    await showNeutral(input.registration);
    return;
  }
  await input.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    lang: payload.lang,
    dir: payload.lang === 'ar' ? 'rtl' : 'ltr',
    data: { url: safeUrl(payload.url) },
  });
}

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * هاندلر ضغطة الإشعار: بيقفل الإشعار، وبيركّز نافذة مفتوحة من نفس الأصل، أو بيفتح صفحة.
 *
 * @param input الإشعار والنوافذ وأصل الصفحة
 */
export async function handleNotificationClick(input: {
  notification: SwNotification;
  clients: SwClients;
  origin: string;
}): Promise<void> {
  input.notification.close();
  const url = safeUrl(input.notification.data?.url);
  const windows = await input.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((client) => isSameOrigin(client.url, input.origin));
  if (open !== undefined) {
    await open.focus();
    if (typeof open.navigate === 'function') await open.navigate(url);
    return;
  }
  await input.clients.openWindow(url);
}
