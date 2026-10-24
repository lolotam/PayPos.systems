// طبقة المتصفح: كل حاجة بتلمس PushManager أو Notification أو service worker موجودة هنا،
// وباقي ملفات الإشعارات بتستعمل الدوال دي بس عشان الاختبارات تقدر تستبدلها (ADR-0052 §7).

/** حالة إذن الإشعارات في المتصفح. */
export type PushPermission = 'default' | 'granted' | 'denied';

/** الحد الأدنى من اشتراك المتصفح اللي بيحتاجه التطبيق. */
export interface PushSubscriptionLike {
  endpoint: string;
  unsubscribe(): Promise<boolean>;
  toJSON(): {
    endpoint?: string;
    expirationTime?: number | null;
    keys?: { p256dh?: string; auth?: string };
  };
}

interface StandaloneNavigator extends Navigator {
  standalone?: boolean;
}

// رقم كل محاولة اشتراك، ورقم آخر محاولة نجحت: المحاولة المتأخرة ما تشيلش اشتراك
// بناءً تشغيل أحدث نجح فعلاً (ADR-0052 §7).
let subscribeAttempt = 0;
let lastSucceededAttempt = 0;

export function hasServiceWorker(): boolean {
  return typeof globalThis.navigator !== 'undefined' && 'serviceWorker' in globalThis.navigator;
}

export function hasPushManager(): boolean {
  return 'PushManager' in globalThis;
}

export function hasNotification(): boolean {
  return 'Notification' in globalThis;
}

/** المتصفح بيقدر يستقبل إشعارات: service worker و PushManager و Notification موجودين. */
export function supportsPush(): boolean {
  return hasServiceWorker() && hasPushManager() && hasNotification();
}

/** آيفون أو آيباد: iPadOS بيبعت نفسه MacIntel وبيحسب نقاط اللمس على الشاشة. */
export function isIosDevice(): boolean {
  const nav = globalThis.navigator;
  const agent = nav?.userAgent ?? '';
  if (/iPhone|iPad|iPod/i.test(agent)) return true;
  return /MacIntel/i.test(agent) && (nav?.maxTouchPoints ?? 0) > 1;
}

/** التطبيق متضاف على الشاشة الرئيسية: iOS بيعمل كده، والويب بيقولها display-mode. */
export function isStandalone(): boolean {
  const nav = globalThis.navigator as StandaloneNavigator | undefined;
  if (nav?.standalone === true) return true;
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia('(display-mode: standalone)').matches;
}

export function notificationPermission(): PushPermission {
  if (!hasNotification()) return 'default';
  const value = globalThis.Notification.permission;
  return value === 'granted' || value === 'denied' ? value : 'default';
}

export async function requestNotificationPermission(): Promise<PushPermission> {
  if (!hasNotification()) return 'denied';
  const result = await globalThis.Notification.requestPermission();
  return result === 'granted' || result === 'denied' ? result : 'default';
}

export async function currentSubscription(): Promise<PushSubscriptionLike | null> {
  if (!hasServiceWorker()) return null;
  const registration = await globalThis.navigator.serviceWorker.getRegistration();
  if (registration === undefined) return null;
  return registration.pushManager.getSubscription();
}

export async function subscribePush(
  applicationServerKey: Uint8Array<ArrayBuffer>,
): Promise<PushSubscriptionLike> {
  const registration = await globalThis.navigator.serviceWorker.ready;
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
}

export async function unsubscribePush(): Promise<boolean> {
  const subscription = await currentSubscription();
  if (subscription === null) return false;
  return subscription.unsubscribe();
}

/**
 * اشتراك بيتعمل من غير ما ينفع تلغيه: لو الوقت عدّى، الاشتراك اللي يوصل متأخر بيتشال
 * بس لو مفيش تشغيل أحدث تبناه — المتصفح ماسك اشتراك واحد بس، فالتشغيل الجديد ممكن يكون
 * هو نفسه الاشتراك المتأخر (ADR-0052 §7).
 *
 * @param applicationServerKey المفتاح العام
 * @param ms المهلة بالميلي ثانية
 * @returns الاشتراك أو null
 */
export async function subscribeWithDeadline(
  applicationServerKey: Uint8Array<ArrayBuffer>,
  ms: number,
): Promise<PushSubscriptionLike | null> {
  const attempt = (subscribeAttempt += 1);
  const pending = subscribePush(applicationServerKey);
  let timer = 0;
  const deadline = new Promise<null>((resolve) => {
    timer = window.setTimeout(() => resolve(null), ms);
  });
  const settled = await Promise.race([pending.then((value) => value).catch(() => null), deadline]);
  window.clearTimeout(timer);
  if (settled !== null) {
    lastSucceededAttempt = attempt;
    return settled;
  }
  void pending
    .then((late) => {
      // تشغيل أحدث نجح هو ده اللي ماسك الاشتراك؛ غير كده المتأخر يتشال (ADR-0052 §7).
      if (lastSucceededAttempt > attempt) return undefined;
      return late.unsubscribe();
    })
    .catch(() => undefined);
  return null;
}

/** جسم الاشتراك اللي بيروح للـ API: من غير قيم ناقصة، لأن الـ API بيرفض طول المفتاح الغلط. */
export function pushSubscriptionBody(subscription: PushSubscriptionLike): {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
} {
  const json = subscription.toJSON();
  const endpoint = json.endpoint ?? subscription.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) throw new Error('PUSH_SUBSCRIPTION_INCOMPLETE');
  return { endpoint, expirationTime: json.expirationTime ?? null, keys: { p256dh, auth } };
}

/** المفتاح العام بيجي base64url من الـ API، والمتصفح عايزه بايتات. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
