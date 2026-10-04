import type { EmployeeRecord } from '@pospay/domain';
import type { ImportCommitPreview } from '../domain/employee-import.ts';

/** نطاق الإنشاء الذري؛ لا يخرج أي اتصال من معاملة الشركة. */
export interface ImportCommitScope {
  /** المعاينة المقفلة؛ null للمجهول أو المعاينة خارج الشركة. */
  readonly preview: ImportCommitPreview | null;
  /**
   * يثبت الفروع الحالية تحت أقفال تمنع حذفها أثناء الإنشاء.
   *
   * @param businessId نشاط المعاينة
   */
  branches(businessId: string): Promise<readonly string[]>;
  /**
   * يكتب الموظفين والارتباطات والتدقيق والأحداث في الدفعة نفسها.
   *
   * @param records سجلات الموظفين المحققة
   */
  insert(records: readonly EmployeeRecord[]): Promise<void>;
  /**
   * يحفظ نتيجة الالتزام وحدث الملخص بنفس اللحظة المحقونة.
   *
   * @param preview المعاينة المقفلة
   * @param records الموظفون المنشؤون
   * @param at لحظة الالتزام المحقونة
   */
  complete(
    preview: ImportCommitPreview,
    records: readonly EmployeeRecord[],
    at: string,
  ): Promise<void>;
}

/** معاملة الوظيفة؛ الفشل النهائي يسجل في معاملة لاحقة بعد التراجع. */
export interface ImportCommitTransactions {
  /**
   * يشغل الخطوات داخل withTenant وبقفل المعاينة.
   *
   * @param companyId الشركة في غلاف الوظيفة
   * @param previewId معرف المعاينة
   * @param work خطوات الإنشاء الذري
   */
  run(
    companyId: string,
    previewId: string,
    work: (scope: ImportCommitScope) => Promise<void>,
  ): Promise<void>;
  /**
   * يسجل رفضاً ثابتاً فقط إن كانت المعاينة ما زالت commit_requested.
   *
   * @param companyId شركة الوظيفة
   * @param previewId المعاينة المقبولة
   * @param code سبب الرفض الثابت
   */
  fail(companyId: string, previewId: string, code: string): Promise<void>;
}
