/** ربط قائم لا يستبدله الموظف؛ المدير يفك الربط في PR21 قبل تسجيل جديد. */
export class PasskeyBindingError extends Error {
  /** يحمل رمز رفض محدوداً بلا بيانات الاعتماد.
   *
   * @param code سبب الرفض
   */
  constructor(readonly code: 'PASSKEY_ALREADY_BOUND' | 'PASSKEY_INVALID' | 'FORBIDDEN') {
    super(code);
  }
}

/** لا يحمل إثبات OTP إذناً تجارياً؛ يكفي موظف نشط وعضوية تغطي مكانه.
 *
 * @param companyId الشركة الموثقة
 * @param businessId نشاط الموظف
 * @param branchIds فروع الموظف
 * @param memberships العضويات السارية
 * @returns أهلية الدخول الشخصي دون منح صلاحيات
 */
export function personalMember(
  companyId: string,
  businessId: string,
  branchIds: readonly string[],
  memberships: readonly { scope_type: 'COMPANY' | 'BUSINESS' | 'BRANCH'; scope_id: string }[],
): boolean {
  return memberships.some(
    (membership) =>
      (membership.scope_type === 'COMPANY' && membership.scope_id === companyId) ||
      (membership.scope_type === 'BUSINESS' && membership.scope_id === businessId) ||
      (membership.scope_type === 'BRANCH' && branchIds.includes(membership.scope_id)),
  );
}

/** قرار الربط الأول والنسخة التالية مأخوذان من التاريخ تحت قفل الموظف.
 *
 * @param active هل يوجد ربط نشط
 * @param highestRevision أعلى نسخة تاريخية
 * @returns النسخة التالية أو رفض الاستبدال
 */
export function nextBindingRevision(active: boolean, highestRevision: number): number {
  if (active) throw new PasskeyBindingError('PASSKEY_ALREADY_BOUND');
  return highestRevision + 1;
}
