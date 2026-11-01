import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { CustomerRecord } from '../domain/customer.ts';
import type { CustomerBirthday } from '../domain/profile.ts';

/** بيانات إنشاء العميل؛ الوقت والمعرّف يأتيان من الـ ports المحقونة. */
export interface NewCustomer {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly locale: 'ar' | 'en';
  readonly at: Date;
  /** النوع اختياري: لو اتساب مش بيتخزّن (S-1). */
  readonly gender?: 'female' | 'male';
  /** تاريخ الميلاد اختياري؛ تقويمه اتأكد في الـ domain قبل أي كتابة. */
  readonly birthday?: CustomerBirthday;
  /** البريد اختياري؛ شكله اتأكد في الـ domain قبل أي كتابة. */
  readonly email?: string;
}

/** ملاحظة عميل واحدة لنشاط واحد؛ السطر ثابت (مفيش تعديل ولا حذف). */
export interface NewCustomerNote {
  readonly customerId: string;
  readonly businessId: string;
  readonly note: string;
  readonly at: Date;
}

/** كتابة العميل وسجل إنشائه على نفس المعاملة كي لا يُحفظ تغيير بلا سجل. */
export interface CustomerScope {
  readonly audit: AuditTrail;
  /**
   * يدوّر على العميل بهاتفه.
   *
   * @param phone الهاتف بصيغة E.164
   * @returns العميل الموجود، أو null لو الهاتف مش متسجّل
   */
  findByPhone(phone: string): Promise<CustomerRecord | null>;
  /**
   * ينشئ العميل مرة واحدة؛ لو حد تاني سبقه في نفس اللحظة بيرجع الصف الفائز بلا إنشاء.
   *
   * @param customer بيانات العميل المراد تعريفه
   * @returns العميل الفائز وحقيقة الإنشاء
   */
  create(customer: NewCustomer): Promise<{ customer: CustomerRecord; created: boolean }>;
  /**
   * يحفظ ملاحظة العميل لنشاط واحد.
   *
   * @param note الملاحظة ونشاطها والوقت
   */
  addNote(note: NewCustomerNote): Promise<void>;
  /**
   * يحوّل الفرع إلى النشاط اللي بيخدمه.
   *
   * @param branchId الفرع
   * @returns معرّف النشاط
   */
  branchBusiness(branchId: string): Promise<string>;
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
