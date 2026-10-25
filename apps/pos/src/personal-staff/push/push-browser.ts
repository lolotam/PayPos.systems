// طبقة المتصفح: كل حاجة بتلمس PushManager أو Notification أو service worker موجودة هنا،
// وباقي ملفات الإشعارات بتستعمل الدوال دي بس عشان الاختبارات تقدر تستبدلها (ADR-0052 §7).
import { hasCrossTabLock } from './push-lock';

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

// رقم كل محاولة اشتراك، ورقم آخر محاولة نجحت، واستقرار كل المحاولات اللي بدأت:
// المحاولة المتأخرة تستنى تشغيل أحدث لسه شغال عشان ما تشيلش اشتراكه (ADR-0052 §7).
let subscribeAttempt = 0;
let lastSucceededAttempt = 0;
let latestAttemptsSettlement: Promise<void> = Promise.resolve();

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

/**
 * التشغيل محتاج كمان قفل حقيقي بين التبويبات: تشغيلين متوازيين بيركبوا على اشتراك واحد
 * وسطر واحد على السيرفر. الإلغاء وكشف اشتراك موجود بيبقوا بـ supportsPush بس عشان يفضلوا
 * متاحين على الموبايل المشترك (ADR-0052 §7).
 *
 * @returns true لو المتصفح يقدر يشغّل إشعاراته
 */
export function canEnablePush(): boolean {
  return supportsPush() && hasCrossTabLock();
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

/** المتأخر يستنى أي محاولة أحدث لسه شغالة: المتصفح ممكن يديها نفس الاشتراك اللي هيشيله. */
async function discardLateSubscription(attempt: number, late: PushSubscriptionLike): Promise<void> {
  while (lastSucceededAttempt <= attempt) {
    const newest = latestAttemptsSettlement;
    await newest;
    if (newest === latestAttemptsSettlement) break;
  }
  if (lastSucceededAttempt <= attempt) await late.unsubscribe();
}

/**
 * اشتراك بيتعمل من غير ما ينفع تلغيه: لو الوقت عدّى، الاشتراك اللي يوصل متأخر بيتشال
 * بس بعد ما أي تشغيل أحدث يستقر ولو مفيش تشغيل أحدث تبناه — المتصفح ماسك اشتراك واحد بس،
 * فالتشغيل الجديد ممكن يكون هو نفسه الاشتراك المتأخر (ADR-0052 §7).
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
  let settleAttempt = (): void => undefined;
  const attemptSettlement = new Promise<void>((resolve) => {
    settleAttempt = resolve;
  });
  latestAttemptsSettlement = Promise.all([latestAttemptsSettlement, attemptSettlement]).then(
    () => undefined,
  );
  let timer = 0;
  const deadline = new Promise<null>((resolve) => {
    timer = window.setTimeout(() => resolve(null), ms);
  });
  const settled = await Promise.race([pending.then((value) => value).catch(() => null), deadline]);
  window.clearTimeout(timer);
  if (settled !== null) lastSucceededAttempt = attempt;
  settleAttempt();
  if (settled !== null) return settled;
  void pending.then((late) => discardLateSubscription(attempt, late)).catch(() => undefined);
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
