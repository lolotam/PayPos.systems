import type { BindingRevision } from '../domain/unbind-passkey.ts';

/** النطاق المحقق يأتي من جلسة المدير لا من بيانات الطلب. */
export interface ManagerPasskeyScope {
  companyId: string;
  businessId: string;
  employeeId: string;
  userId: string;
}
/** تجميع الموظف المقفول مع حالته يمنع تغيّر الربط بين الفحص والفك. */
export interface UnbindPasskeyTransaction {
  readonly ownBinding: boolean;
  readonly binding: BindingRevision | null;
  /** يثبت الفك والسبب والتدقيق والحدث معاً ويحتفظ بالتاريخ.
   *
   * @param change النسخة الجديدة والسبب والتوقيت المحقّق
   * @param change.revision النسخة الملغية الجديدة
   * @param change.reason السبب المنظف للتدقيق
   * @param change.at الوقت المحقون للفك
   */
  save(change: { revision: number; reason: string; at: Date }): Promise<void>;
}
/** المعاملة تملك الأقفال وإعادة التحقق الحي؛ use case لا يعرف تفاصيل التخزين. */
export interface UnbindPasskeyTransactions {
  /** يرفض النطاق الممنوع كالغياب قبل إظهار أي معلومات عن الموظف.
   *
   * @param scope مدير وموظف في الشركة المتحقق منها
   * @param work خطوة الفك تحت نفس الأقفال
   */
  run<T>(
    scope: ManagerPasskeyScope,
    work: (transaction: UnbindPasskeyTransaction) => Promise<T>,
  ): Promise<T>;
}
