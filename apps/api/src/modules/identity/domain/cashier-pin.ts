// PIN الكاشير (PRD D-08، قرار Waleed 2026-09-23): 4 أرقام، وبيتقفل بعد 5 محاولات غلط لمدة 15 دقيقة.
export const CASHIER_PIN_DIGITS = 4;
export const PIN_MAX_FAILURES = 5;
// نفس المدة للاتنين: الغلطات بتتعد في window 15 دقيقة من أولها، والقفل 15 دقيقة من الغلطة الخامسة.
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
