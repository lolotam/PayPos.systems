import { privateViewCalls } from './private-view-calls';
import { workCalls } from './my-work-calls';

/** أقل فاصل بين لمستين إدخال للسيرفر. */
export const TOUCH_INTERVAL_MS = 20_000;
/** فاصل فحص الساعة الجدارية مقابل الرتيبة وموعد القفل. */
export const TICK_MS = 1_000;
/** أقصى فرق بين تقدّم الساعة الجدارية والرتيبة بين فحصين قبل ما نعتبر الجهاز نام أو الساعة اتغيّرت. */
export const CLOCK_DRIFT_MS = 1_500;

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
  open: (pin) => privateViewCalls.open(pin),
  touch: (windowId, signal) => privateViewCalls.touch(windowId, signal),
  close: (windowId) => privateViewCalls.close(windowId),
  lines: (read) => workCalls.lines(read),
  tips: (read) => workCalls.tips(read),
};
