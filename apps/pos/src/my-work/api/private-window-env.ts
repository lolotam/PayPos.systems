import type { PrivateViewWindow } from '@pospay/contracts';
import { privateViewCalls } from './private-view-calls';
import { workCalls } from './my-work-calls';

/** أقل فاصل بين لمستين إدخال للسيرفر. */
export const TOUCH_INTERVAL_MS = 20_000;
/** مدة الخمول اللي بعدها الشاشة ترجع لخطوة الـ PIN من آخر إدخال لها (D-A13، AC-57-4-5)؛ بتتحسب في التاب من آخر إدخال فعلي مش من آخر لمسة اتبعتت. */
export const IDLE_LIMIT_MS = 60_000;
/** فاصل فحص الساعة الجدارية مقابل الرتيبة وموعد القفل. */
export const TICK_MS = 1_000;
/** أقصى فرق بين تقدّم الساعة الجدارية والرتيبة بين فحصين قبل ما نعتبر الجهاز نام أو الساعة اتغيّرت. */
export const CLOCK_DRIFT_MS = 1_500;
/** أقصى انتظار لرد فتح النافذة؛ بعده الطلب بيتلغى والنموذج يتفتح تاني بدل ما يفضل مقفول على رد مش جاي. */
export const OPEN_TIMEOUT_MS = 20_000;

/** الساعات والمؤقتات: بتتحقن في الاختبارات، والافتراضي بيقرا الـ globals وقت الاستعمال (يتماشى مع المؤقتات المزيفة). */
export type PrivateWindowEnv = {
  /** الساعة الرتيبة: المصدر الوحيد لمواعيد النافذة. */
  mono: () => number;
  /** الساعة الجدارية: لكشف تغيّر ساعة الجهاز أو النوم بس. */
  wall: () => number;
  online: () => boolean;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

/** استدعاءات السيرفر اللي المتحكم بيعملها؛ كلها من الـ client المولّد. */
export type PrivateWindowCalls = {
  open: typeof privateViewCalls.open;
  touch: typeof privateViewCalls.touch;
  close: typeof privateViewCalls.close;
  lines: typeof workCalls.lines;
  tips: typeof workCalls.tips;
  commissionEstimate: typeof workCalls.commissionEstimate;
};

export type PrivateWindowDeps = { env: PrivateWindowEnv; calls: PrivateWindowCalls };

export const defaultEnv: PrivateWindowEnv = {
  mono: () => performance.now(),
  wall: () => Date.now(),
  online: () => navigator.onLine,
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const defaultCalls: PrivateWindowCalls = {
  open: (pin, signal) => privateViewCalls.open(pin, signal),
  touch: (windowId, signal) => privateViewCalls.touch(windowId, signal),
  close: (windowId) => privateViewCalls.close(windowId),
  lines: (read) => workCalls.lines(read),
  tips: (read) => workCalls.tips(read),
  commissionEstimate: (read) => workCalls.commissionEstimate(read),
};

/**
 * بيفتح النافذة بمهلة: بعد المهلة الطلب بيتلغى والانتظار نفسه بيترفض، حتى لو الاستدعاء ما بيسمعش الإلغاء
 * (مثلاً واقف على قراءة قبل الإرسال)، فقفل الإرسال بيتفك. لو الفتح نجح بعد كده نافذته بتتقفل على السيرفر.
 * الإلغاء في العميل مش بيأكد إن السيرفر ما نفّذش الفتح؛ النافذة اللي ممكن تكون اتفتحت بتنتهي بمهلة الخمول على السيرفر.
 *
 * @param deps الساعات والاستدعاءات
 * @param pin الأربع أرقام
 * @returns النافذة المفتوحة
 */
export async function openWithin(deps: PrivateWindowDeps, pin: string): Promise<PrivateViewWindow> {
  const stop = new AbortController();
  const opening = deps.calls.open(pin, stop.signal);
  let timer: unknown;
  const limit = new Promise<never>((_resolve, reject) => {
    timer = deps.env.setTimer(() => {
      stop.abort();
      void opening.then((late) => deps.calls.close(late.window_id)).catch(() => undefined);
      reject(new Error('private view open timed out'));
    }, OPEN_TIMEOUT_MS);
  });
  try {
    return await Promise.race([opening, limit]);
  } finally {
    deps.env.clearTimer(timer);
  }
}
