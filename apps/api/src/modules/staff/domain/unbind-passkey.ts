/** أخطاء الفك لا تحمل وجود موظف ممنوع أو أي مادة اعتماد. */
export class UnbindPasskeyError extends Error {
  /** يحدد نتيجة الرفض الآمنة للعميل.
   *
   * @param code سبب الرفض دون تفاصيل حساسة
   */
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'FEATURE_DISABLED'
      | 'PASSKEY_SELF_UNBIND'
      | 'PASSKEY_REVISION_CONFLICT'
      | 'VALIDATION_FAILED',
  ) {
    super(code);
  }
}
/** نسخة الربط المحفوظة؛ unboundAt يجعل كل إثبات سابق غير صالح. */
export interface BindingRevision {
  readonly id: string;
  readonly revision: number;
  readonly unboundAt: Date | null;
}

/** يفحص الإثبات مقابل الربط المقفول؛ UV لا يغني عن إعادة فحص النسخة في معاملة الحضور.
 *
 * @param binding الربط الحالي المقفول أو الغائب
 * @param proof معرف ونسخة الربط اللذان تحقق منهما auth
 * @param proof.bindingId معرف الربط القديم
 * @param proof.bindingRevision نسخة الربط وقت التحقق
 * @returns هل الربط نشط ونفس النسخة
 */
export function bindingAcceptsProof(
  binding: BindingRevision | null,
  proof: { bindingId: string; bindingRevision: number },
): boolean {
  return (
    binding !== null &&
    binding.unboundAt === null &&
    binding.id === proof.bindingId &&
    binding.revision === proof.bindingRevision
  );
}

/** يمنع الفك الذاتي والكتابة من شاشة قديمة ويعطي النسخة الملغية الجديدة.
 *
 * @param binding الربط النشط بعد الأقفال
 * @param input المعرف والنسخة والسبب المطلوب
 * @param input.binding_id معرف الربط المعروض للمدير
 * @param input.revision النسخة المتوقعة لمنع تبويب قديم
 * @param input.reason سبب الفك الإلزامي
 * @param ownBinding هل المستخدم هو الموظف نفسه
 * @returns النسخة الملغية والسبب المنظف
 */
export function planPasskeyUnbind(
  binding: BindingRevision | null,
  input: { binding_id: string; revision: number; reason: string },
  ownBinding: boolean,
) {
  if (ownBinding) throw new UnbindPasskeyError('PASSKEY_SELF_UNBIND');
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 500) throw new UnbindPasskeyError('VALIDATION_FAILED');
  if (
    !bindingAcceptsProof(binding, {
      bindingId: input.binding_id,
      bindingRevision: input.revision,
    }) ||
    binding === null ||
    binding.revision >= 2147483647
  )
    throw new UnbindPasskeyError('PASSKEY_REVISION_CONFLICT');
  return { revision: binding.revision + 1, reason };
}
