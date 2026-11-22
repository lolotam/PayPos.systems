import type { PrivateViewDeadlines } from '../model/private-view-deadline';

/** أقل فاصل بين لمستين إدخال للسيرفر. */
export const PRIVATE_VIEW_TOUCH_MS = 20_000;
/** فاصل الفحص الدوري للمواعيد الجدارية والمفتاح المشترك. */
export const PRIVATE_VIEW_TICK_MS = 5_000;

/** الساعة الرتيبة للتاب: المصدر الوحيد للوقت في النافذة، والاختبارات بتتحكم فيها بالمؤقتات المزيفة. */
export const monotonicNow = (): number => performance.now();
/** الساعة الجدارية المشتركة بين التابات، للمفتاح المشترك وفحص ساعة الجهاز بس. */
export const wallNow = (): number => Date.now();

/**
 * نافذة مفتوحة ومواعيدها اللي أكّدها السيرفر في رد الفتح. `sentWall` الساعة الجدارية لحظة إرسال
 * آخر طلب نجح (في الذاكرة بس). المفتاح المشترك لازم يكون اتكتب قبل ما النافذة تتعرض.
 */
export type ConfirmedWindow = {
  windowId: string;
  deadlines: PrivateViewDeadlines;
  sentWall: number;
};

/**
 * `all`: النافذة خلصت لكل التابات (قفل في السيرفر ومسح المفتاح وبلاغ). `self`: خلصت من برّه
 * (تاب تاني قفلها أو نافذة أحدث خدت مكانها أو المفتاح بقى مش مقروء) فالتاب بيمسح نفسه بس.
 */
export type CloseScope = 'all' | 'self';

export type ClockHandlers = {
  /** إخفاء الشاشة ومسح كاشها لحد ما لمسة تتأكد. */
  hide: () => void;
  /** اللمسة نجحت في الدورة الحالية: الشاشة ترجع. */
  show: () => void;
  close: (scope: CloseScope) => void;
  /** رفض السيرفر للمسة (النافذة أو الجلسة خلصت). */
  refused: (error: unknown) => void;
};

export type ClockEnv = { mono: () => number; wall: () => number };

/**
 * اللي الساعة بتديه للشاشة: الإيقاف، ورقم دورة الظهور الحالية، وسياج النافذة قبل أي نشر أو عرض.
 * رد قراءة بيتنشر بس لو نافذته هي الحالية ودورته (`epoch` وقت إرسال الطلب) هي الحالية ومتحقَّق منها.
 */
export type PrivateViewClockHandle = {
  stop: () => void;
  /** رقم دورة الظهور الحالية، بيتاخد وقت إرسال القراءة. */
  epoch: () => number;
  /** بيفحص ويقفل التاب لو النافذة مش الحالية؛ false = ارمي الرد. */
  fence: (windowId: string, epoch: number) => boolean;
  /** نفس الفحص من غير ما يقفل حاجة، لمنع العرض أثناء الرسم. */
  isCurrent: (windowId: string) => boolean;
};
