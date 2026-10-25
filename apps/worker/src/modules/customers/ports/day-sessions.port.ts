import type { Tx } from '@pospay/db';
import type { ActiveLine } from '../domain/sessions-of-day.ts';

/** نطاق مجمد يمنع اختلاط كتابات حية جديدة بصفحات الـ bootstrap. */
export interface BootstrapRange {
  readonly cutoff: Date;
  readonly maxSessionId: string;
  readonly recordedAtOrBefore: Date;
}

/** صف زيارة مختصر يكفي لتغذية مسار الجدولة الحي نفسه أثناء الـ bootstrap. */
export interface BootstrapSession {
  readonly sessionId: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly branchId: string;
  readonly occurredAt: Date;
}

/** حالة الزيارات الموجودة في orders، وتصل بحقن callback حتى لا يستوردها customers. */
export interface DaySessionsPort {
  /**
   * يرجع البنود النشطة ومنفذيها في نافذة اليوم لإعادة حساب الجدولة والإسناد من المصدر.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للزيارات
   * @param businessId النشاط المطلوب
   * @param customerId العميل صاحب الزيارات
   * @param fromInstant بداية النافذة الشاملة
   * @param toInstant نهاية النافذة غير الشاملة
   * @returns البنود النشطة داخل النافذة
   */
  activeLines(
    tx: Tx,
    companyId: string,
    businessId: string,
    customerId: string,
    fromInstant: Date,
    toInstant: Date,
  ): Promise<readonly ActiveLine[]>;
  /**
   * يرجع صفحة keyset من كل زيارات النطاق المجمد؛ الجدولة تفحص البنود النشطة عشان الإلغاء ما يغيّرش عدّ التغطية.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للزيارات
   * @param range النطاق المجمد للقراءة
   * @param afterSessionId آخر معرف في الصفحة السابقة أو null للبداية
   * @param limit الحد الأقصى لعدد الصفوف
   * @returns صفحة الزيارات المختصرة
   */
  sessionsSince(
    tx: Tx,
    companyId: string,
    range: BootstrapRange,
    afterSessionId: string | null,
    limit: number,
  ): Promise<readonly BootstrapSession[]>;
  /**
   * يرجع عدد الزيارات المشمولة بالنطاق للتحقق من تغطية الـ bootstrap.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للزيارات
   * @param range النطاق المجمد للقراءة
   * @returns عدد الزيارات المشمولة
   */
  countSince(tx: Tx, companyId: string, range: BootstrapRange): Promise<number>;
  /**
   * يرجع أعلى معرف زيارة لتجميد نطاق الـ bootstrap قبل أول صفحة.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للزيارات
   * @returns أعلى session_id أو null عندما لا توجد زيارات
   */
  watermark(tx: Tx, companyId: string): Promise<string | null>;
}
