export const CLOCK = Symbol('CLOCK');

/**
 * الوقت الحالي كـ port (CLAUDE.md §4.3): الـ use case مبينادي Date.now() بنفسه،
 * عشان الاختبار يثبّت الوقت ويبقى deterministic.
 */
export interface Clock {
  /** اللحظة الحالية بالـ UTC — الـ use case بيستخدمها في أي قرار معتمد على الوقت. */
  now(): Date;
}
