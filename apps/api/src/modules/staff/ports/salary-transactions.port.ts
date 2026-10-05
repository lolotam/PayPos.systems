import type { SalaryRecord } from '../domain/set-salary.ts';

/** معاملة الراتب تحفظ الأقفال والتدقيق والحدث والرد كوحدة واحدة. */
export interface SalaryTransaction {
  /**
   * يحمل تاريخاً واحداً بعد قفل الموظف لتسلسل النسخ.
   *
   * @param employeeId الموظف المقفول
   * @param date تاريخ السريان
   */
  load(employeeId: string, date: string): Promise<SalaryRecord | null>;
  /**
   * يحفظ النسخة والتدقيق والحدث داخل نفس المعاملة.
   *
   * @param businessId النشاط المحفوظ
   * @param before النسخة السابقة
   * @param after النسخة التالية
   */
  save(businessId: string, before: SalaryRecord | null, after: SalaryRecord): Promise<void>;
}
/** الغلاف يربط الرد المعاد بمفتاح الطلب ولا يعيد الكتابة عند التكرار. */
export interface SalaryTransactions {
  /**
   * يعيد الرد المخزن بعد إعادة التحقق من الصلاحيات أو ينفذ الكتابة مرة واحدة.
   *
   * @param context سياق الطلب الموثق
   * @param work خطوة النطاق داخل المعاملة
   */
  run(
    context: SalaryContext,
    work: (tx: SalaryTransaction) => Promise<SalaryRecord>,
  ): Promise<SalaryRecord>;
}
/** مصدر المعرفات المحقون يبقي الاختبارات حتمية. */
export interface SalaryIds {
  /** معرف UUID v7 لإنشاء سجل جديد. */
  newId(): string;
}
/** بيانات السياق الموثقة ومفتاح إعادة الطلب. */
export interface SalaryContext {
  companyId: string;
  userId: string;
  businessId: string;
  employeeId: string;
  key: string;
  fingerprint: string;
}
