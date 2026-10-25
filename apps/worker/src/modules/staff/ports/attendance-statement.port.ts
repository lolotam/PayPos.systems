import type { AttendanceOpenSession, StoredBusinessIdentity } from '@pospay/domain';
import type { StatementInputs } from '../domain/attendance-statement-data.ts';

/**
 * يقرأ هوية النشاط المخزنة من جوه معاملة القارئ؛ الأسماء الرسمية ومعرف الشعار كما اتخزّنوا.
 * القراءة بتتم في معاملة الطلب نفسها عشان الهوية تطلع بنفس لحظة الطلب.
 */
export interface StatementIdentityReader<Transaction> {
  /**
   * الأسماء الرسمية ومعرف الشعار المخزّنين.
   *
   * @param tx معاملة الشركة المفتوحة
   * @param companyId الشركة
   * @param businessId النشاط
   * @returns الهوية المخزّنة
   */
  read(tx: Transaction, companyId: string, businessId: string): Promise<StoredBusinessIdentity>;
}

/**
 * يقرأ جلسات الموظفة المفتوحة في الفترة: يوم العمل ودخول البصمة بس.
 * الجلسة المفتوحة بتطبع «لسه جوّه» وما بتتحسبش في أي رقم (FR-011a).
 */
export type StatementOpenSessionsReader<Transaction> = (
  tx: Transaction,
  companyId: string,
  branchId: string,
  employeeId: string,
  from: string,
  to: string,
) => Promise<AttendanceOpenSession[]>;

/**
 * يقرأ مدخلات البيان كلها في معاملة قراءة واحدة: طلب البيان وأسماؤه ومدخلات الحضور.
 * مفيش كتابة في أي جدول، والصفوف بترجع زي ما اتقريت (FR-011).
 */
export interface StatementInputsReader {
  /**
   * بيفتح معاملة قراءة واحدة ويقرا طلب البيان ومدخلاته.
   *
   * @param companyId الشركة
   * @param renderId معرف الرندر وهو معرف صف الطلب
   * @param signal إلغاء المهلة
   * @returns المدخلات الخام أو null لما صف الطلب مش موجود
   */
  read(companyId: string, renderId: string, signal?: AbortSignal): Promise<StatementInputs | null>;
}
