// PIN الكاشير (PRD D-08، قرار Waleed 2026-09-23): 4 أرقام، وبيتقفل بعد 5 محاولات غلط لمدة 15 دقيقة.
export const CASHIER_PIN_DIGITS = 4;
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_SECONDS = 15 * 60;

/**
 * هل الـ PIN شكله صح — 4 أرقام بالظبط، ولا حاجة تانية.
 *
 * @param pin الـ PIN زي ما اتكتب
 * @returns true لو 4 أرقام
 */
export function isWellFormedCashierPin(pin: string): boolean {
  return new RegExp(`^[0-9]{${CASHIER_PIN_DIGITS}}$`).test(pin);
}

/**
 * هل المحاولة رقم كذا مقفولة قبل ما نبص في الـ PIN أصلاً. كل محاولة بتتحجز وتتعد قبل المقارنة، فحتى لو جت 10 طلبات
 * في نفس اللحظة، 5 بس هيتقارنوا.
 *
 * @param attempt رقم المحاولة في الـ window الحالي (بيبدأ من 1)
 * @returns true لو عدّى الـ 5 — مترفوضة من غير مقارنة
 */
export function isPinAttemptLocked(attempt: number): boolean {
  return attempt > PIN_MAX_FAILURES;
}

/**
 * هل الغلطة دي هي اللي بتقفل الـ PIN — الخامسة بالظبط، والـ 15 دقيقة بتبدأ منها.
 *
 * @param attempt رقم المحاولة اللي طلعت غلط
 * @returns true لو هي الخامسة
 */
export function isLockingFailure(attempt: number): boolean {
  return attempt === PIN_MAX_FAILURES;
}
