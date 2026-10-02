/** قرار محفوظ بالمدة؛ التاريخ لا يُحذف عند الاستبدال أو السحب. */
export interface OverrideDecision {
  readonly effect: 'ALLOW' | 'DENY';
  readonly expires_at: string | null;
}

/**
 * بيحدد القرار الساري عند وقت المعاملة، والانتهاء عند نفس اللحظة محسوب منتهي.
 *
 * @param decision القرار المحفوظ
 * @param now وقت المعاملة بعد قفل العضويات
 * @returns هل القرار لسه ساري
 */
export function overrideIsCurrent(decision: OverrideDecision, now: Date): boolean {
  return decision.expires_at === null || new Date(decision.expires_at) > now;
}

/**
 * بيحمي سماح المالك وبيحدد السحب أو الاستبدال من غير تكديس قرارات.
 *
 * @param operation سحب أو حفظ قرار جديد
 * @param current القرارات السابقة المطلوبة للعملية
 * @param owner هل صاحب العضوية يحمل دور المالك في أي عضوية سارية داخل الشركة
 * @param now وقت القرار داخل المعاملة
 * @returns الرفض المسمى أو null لو دورة القرار مسموحة
 */
export function overrideLifecycleFailure(
  operation: 'SAVE' | 'REVOKE',
  current: readonly OverrideDecision[],
  owner: boolean,
  now: Date,
): 'PERMISSION_OVERRIDE_ENDED' | 'PERMISSION_OWNER_PROTECTED' | null {
  if (operation === 'REVOKE' && current.some((row) => !overrideIsCurrent(row, now)))
    return 'PERMISSION_OVERRIDE_ENDED';
  if (owner && current.some((row) => row.effect === 'ALLOW')) return 'PERMISSION_OWNER_PROTECTED';
  return null;
}
