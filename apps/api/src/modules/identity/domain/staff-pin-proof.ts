/** عمر دليل تغيير الرقم السري المؤقت: عشر دقايق من لحظة الإصدار (FR-F2-3). */
export const STAFF_PIN_PROOF_TTL_MS = 10 * 60 * 1000;

/**
 * بيحسب لحظة انتهاء دليل تغيير الرقم السري من لحظة إصداره.
 * الحساب هنا مش في use case (CLAUDE.md §4.2) والوظيفة pure عشان تتقاس بلا ساعة حقيقية.
 *
 * @param at لحظة إصدار الدليل
 * @returns لحظة انتهاء الدليل
 */
export function staffPinProofExpiresAt(at: Date): Date {
  return new Date(at.getTime() + STAFF_PIN_PROOF_TTL_MS);
}
