import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { CustomerRecord } from '../domain/customer.ts';

/** بيانات إنشاء العميل؛ الوقت والمعرّف يأتيان من الـ ports المحقونة. */
export interface NewCustomer {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly locale: 'ar' | 'en';
  readonly at: Date;
}

/** كتابة العميل وسجل إنشائه على نفس المعاملة كي لا يُحفظ تغيير بلا سجل. */
export interface CustomerScope {
  readonly audit: AuditTrail;
  /**
   * يعيد العميل أو ينشئه مرة واحدة؛ created تميز من يكتب سجل الإنشاء تحت التزامن.
   *
   * @param customer بيانات العميل المراد تعريفه
   * @returns العميل الفائز وحقيقة الإنشاء
   */
  findOrCreate(customer: NewCustomer): Promise<{ customer: CustomerRecord; created: boolean }>;
}

/** حدود المعاملة لعزل الشركة ولإلغاء إنشاء العميل إذا فشل سجل التدقيق. */
export interface CustomerTransactions {
  /**
   * ينفذ العمل داخل الشركة والمستخدم الموثقين، دون كشف اتصال الداتابيز للـ use case.
   *
   * @param actor سياق الاستقبال الموثق
   * @param actor.companyId الشركة التي أثبتها الحارس
   * @param actor.userId المستخدم الذي يكتب سجل الإنشاء
   * @param work عمل الاستقبال ضمن المعاملة
   * @returns نتيجة العمل بعد نجاح المعاملة
   */
  run<T>(
    actor: { readonly companyId: string; readonly userId: string },
    work: (scope: CustomerScope) => Promise<T>,
  ): Promise<T>;
}
