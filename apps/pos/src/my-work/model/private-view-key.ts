/** مفتاح التخزين المشترك بين تابات الجهاز: بيانات وصفية للنافذة بس (ADR-0019 addendum 2026-10-21، البند 6 و7). */
const KEY = 'pospay-private-view-window';
const CHANNEL = 'pospay-private-view-close';

/** حد الخمول وحد السقف اللي السيرفر بيدّيهم؛ موعد أبعد منهم معناه إن ساعة الجهاز اتحركت. */
export const PRIVATE_VIEW_IDLE_LIMIT_MS = 60_000;
export const PRIVATE_VIEW_CAP_LIMIT_MS = 300_000;

/**
 * اللي بيتخزّن بالظبط: رقم النافذة وإشارة الجلسة وترتيب النافذة وموعدين بالساعة الجدارية.
 * مفيش صفوف ولا PIN ولا أي بيانات شخصية؛ المفتاح من غير جلسة الجهاز مالوش لازمة.
 */
export type SharedKey = {
  windowId: string;
  sessionRef: string;
  windowSeq: string;
  idleWallAt: number;
  capWallAt: number;
};

export type WallStatus = 'live' | 'expired' | 'clock';

const parseSeq = (value: string): bigint | null => (/^\d+$/.test(value) ? BigInt(value) : null);

function parseKey(raw: string | null): SharedKey | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { windowId, sessionRef, windowSeq, idleWallAt, capWallAt } = value as Record<
      string,
      unknown
    >;
    if (typeof windowId !== 'string' || typeof sessionRef !== 'string') return null;
    if (typeof windowSeq !== 'string' || parseSeq(windowSeq) === null) return null;
    if (typeof idleWallAt !== 'number' || !Number.isFinite(idleWallAt)) return null;
    if (typeof capWallAt !== 'number' || !Number.isFinite(capWallAt)) return null;
    return { windowId, sessionRef, windowSeq, idleWallAt, capWallAt };
  } catch {
    return null;
  }
}

/**
 * حالة المفتاح بالساعة الجدارية: حيّ، انتهى، أو ساعة الجهاز مش مضبوطة (موعد أبعد من الحد المسموح).
 * الغلط في أي اتجاه بيقفل بدري: تكلّف الموظفة PIN واحد، ومبتسيبش بيانات على الشاشة أكتر.
 *
 * @param key المفتاح المخزّن
 * @param now الساعة الجدارية دلوقتي
 * @returns الحالة
 */
export function wallStatus(key: SharedKey, now: number): WallStatus {
  if (
    key.idleWallAt - now > PRIVATE_VIEW_IDLE_LIMIT_MS ||
    key.capWallAt - now > PRIVATE_VIEW_CAP_LIMIT_MS
  )
    return 'clock';
  return Math.min(key.idleWallAt, key.capWallAt) <= now ? 'expired' : 'live';
}

/**
 * بيقرا المفتاح. `null` معناه مفيش مفتاح (أو بايظ)، و`'unavailable'` إن التخزين نفسه مقفول.
 *
 * @returns المفتاح أو null أو 'unavailable'
 */
export function readSharedKey(): SharedKey | null | 'unavailable' {
  try {
    return parseKey(localStorage.getItem(KEY));
  } catch {
    return 'unavailable';
  }
}

function writeKey(key: SharedKey): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(key));
    return true;
  } catch {
    return false;
  }
}

/**
 * فتح جديد بيحاول يكتب المفتاح. جلسة مختلفة بتكتب فوق دايماً (الجهاز ليه مشغّلة واحدة)، ونفس
 * الجلسة ما بتكتبش إلا لو الترتيب أكبر بالظبط، فرد فتح أقدم وصل متأخر ما بيكتبش فوق الأحدث.
 * مفتاح انتهى (أو ساعته مش مضبوطة) بيتحسب مش موجود.
 *
 * @param next مفتاح الفتح الجديد
 * @param now الساعة الجدارية دلوقتي
 * @returns `written` اتكتب، `older` فيه نافذة أحدث، `unavailable` التخزين مقفول
 */
export function claimSharedKey(next: SharedKey, now: number): 'written' | 'older' | 'unavailable' {
  const existing = readSharedKey();
  if (existing === 'unavailable') return 'unavailable';
  if (
    existing !== null &&
    wallStatus(existing, now) === 'live' &&
    existing.sessionRef === next.sessionRef
  ) {
    const current = parseSeq(existing.windowSeq);
    const incoming = parseSeq(next.windowSeq);
    if (current === null || incoming === null || incoming <= current) return 'older';
  }
  return writeKey(next) ? 'written' : 'unavailable';
}

/**
 * لمسة نجحت: بتحدّث مواعيد المفتاح لو رقم النافذة هو هو. الخمول ممكن يتحرك لقدام، والسقف بيتقصّر بس.
 *
 * @param windowId نافذة اللمسة
 * @param idleWallAt موعد الخمول الجديد بالساعة الجدارية
 * @param capWallAt موعد السقف بالساعة الجدارية
 * @returns `updated`، أو `mismatch` لو المفتاح مش لنافذتها (اتقفلت أو اتبدلت)، أو `unavailable`
 */
export function extendSharedKey(
  windowId: string,
  idleWallAt: number,
  capWallAt: number,
): 'updated' | 'mismatch' | 'unavailable' {
  const key = readSharedKey();
  if (key === 'unavailable') return 'unavailable';
  if (key === null || key.windowId !== windowId) return 'mismatch';
  const next = {
    ...key,
    idleWallAt: Math.max(key.idleWallAt, idleWallAt),
    capWallAt: Math.min(key.capWallAt, capWallAt),
  };
  return writeKey(next) ? 'updated' : 'unavailable';
}

/**
 * بيمسح المفتاح لو هو لنفس النافذة بس؛ لو نافذة أحدث خدت مكانه بيسيبه زي ما هو.
 *
 * @param windowId النافذة اللي بتتقفل
 */
export function removeSharedKey(windowId: string): void {
  const key = readSharedKey();
  if (key === 'unavailable' || key === null || key.windowId !== windowId) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* السيرفر هو المرجع، والتابات التانية محكومة بمواعيدها. */
  }
}

function openChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}

/**
 * بيبلّغ باقي التابات إن النافذة دي اتقفلت؛ الرسالة بتحمل رقم النافذة بس.
 *
 * @param windowId النافذة اللي اتقفلت
 */
export function announceWindowClosed(windowId: string): void {
  const channel = openChannel();
  try {
    channel?.postMessage({ windowId });
  } catch {
    /* فشل القناة بيسيب إشارة التخزين والمواعيد. */
  } finally {
    channel?.close();
  }
}

/**
 * فتح جديد ما قدرش يكتب المفتاح (الكتابة فشلت) فاتقفل: النافذة الأقدم اللي المفتاح لسه بيسمّيها
 * اتبدلت في السيرفر، فبنقفلها بطريقتين مستقلتين عن بعض: مسح مفتاحها (حدث التخزين أو فحص التاب
 * الدوري بيلاقيه ناقص فيتقفل حتى من غير قناة)، وإبلاغ تابها بالقناة (فوري). المسح بيتأكد قبلها إن
 * المفتاح لسه لنفس النافذة، فمفتاح فتح أحدث ما بيتمسحش. مفيش مفتاح مقروء = مفيش حد نبلّغه؛ التاب
 * الأقدم نفسه بيقفل مغلقاً لما قراية المفتاح بتفشل.
 */
export function announceKeyedWindowReplaced(): void {
  const key = readSharedKey();
  if (key === null || key === 'unavailable') return;
  removeSharedKey(key.windowId);
  announceWindowClosed(key.windowId);
}

function closedWindowId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const { windowId } = data as { windowId?: unknown };
  return typeof windowId === 'string' ? windowId : null;
}

/**
 * التاب بيتابع قفل نافذته من تاب تاني: رسالة القناة برقم نافذته، أو المفتاح اتمسح (رقمه في
 * `oldValue`)، أو اتبدّل بنافذة تانية. إشارة لنافذة غير نافذته بتتجاهل، فمفيش قفل بيوصل لنافذة أحدث.
 *
 * @param windowId نافذة التاب دلوقتي
 * @param retire بتتنده لما نافذته تنتهي من برّه
 * @returns دالة الإيقاف
 */
export function observeWindowSignals(windowId: string, retire: () => void): () => void {
  const channel = openChannel();
  if (channel !== null) {
    channel.onmessage = (event: MessageEvent) => {
      if (closedWindowId(event.data) === windowId) retire();
    };
  }
  const storage = (event: StorageEvent) => {
    if (event.key === null) {
      retire();
      return;
    }
    if (event.key !== KEY) return;
    if (event.newValue === null) {
      if (parseKey(event.oldValue)?.windowId === windowId) retire();
      return;
    }
    if (parseKey(event.newValue)?.windowId !== windowId) retire();
  };
  window.addEventListener('storage', storage);
  return () => {
    channel?.close();
    window.removeEventListener('storage', storage);
  };
}
