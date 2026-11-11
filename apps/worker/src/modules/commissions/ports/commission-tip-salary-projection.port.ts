import type { LockedCommissionPeriod } from '../domain/commission-line-types.ts';
import type {
  CommissionSalaryProjectionRow,
  CommissionTipProjectionSession,
} from '../domain/commission-tip-salary-inputs.ts';
import type {
  CommissionPeriodLockInput,
  CommissionPeriodReopenInput,
} from './commission-line-projection.port.ts';

export type {
  Clock,
  CommissionPeriodLockInput,
  CommissionPeriodReopenInput,
  IdGenerator,
} from './commission-line-projection.port.ts';

export interface HeldCommissionTipProjectionSession extends CommissionTipProjectionSession {
  readonly period: string;
}

export interface CommissionSalaryProjectionWrite extends CommissionSalaryProjectionRow {
  readonly id: string;
}

export interface CommissionTipProjectionScope {
  /**
   * يقفل هوية الجلسة قبل قراءة مراجعتها حتى تتسلسل تحديثات البقشيش المتسابقة.
   *
   * @param sessionId هوية جلسة الخدمة صاحبة البقشيش
   */
  lockSession(sessionId: string): Promise<void>;
  /**
   * يرجع الرأس والصفوف والشهر المحفوظين للمخفّض ولحساب الشهور القديمة والجديدة.
   *
   * @param sessionId هوية الجلسة المطلوب قراءتها بحساب الشركة الحالية
   */
  readTipSession(sessionId: string): Promise<HeldCommissionTipProjectionSession | null>;
  /**
   * يرجع منطقة النشاط لحساب الشهر الحالي، أو null لإيقاف الإسقاط لنشاط مجهول.
   *
   * @param companyId هوية الشركة صاحبة النشاط
   * @param businessId هوية النشاط المطلوب قراءة منطقته الزمنية
   */
  businessTimeZone(companyId: string, businessId: string): Promise<string | null>;
  /**
   * يقفل الشهور المتأثرة والمرشحة ويرجع حالاتها المؤكدة قبل أي كتابة.
   *
   * @param input النشاط والشهور ومولّد هويات الكشوف الجديدة
   */
  lockPeriods(input: CommissionPeriodLockInput): Promise<readonly LockedCommissionPeriod[]>;
  /**
   * يستبدل رأس الجلسة وكل صفوف بقشيشها مع الاحتفاظ بالرأس عند مجموعة فارغة.
   *
   * @param session إسقاط الجلسة الأحدث بكل صفوفه
   */
  replaceTipSession(session: CommissionTipProjectionSession): Promise<void>;
  /**
   * يرجع شهور REVIEWED المتأثرة فقط إلى DRAFT بعد تغيّر مدخلاتها.
   *
   * @param input النشاط والشهور المتأثرة المطلوب إعادة فتحها
   */
  reopenReviewed(input: CommissionPeriodReopenInput): Promise<void>;
}

export interface CommissionSalaryProjectionScope {
  /**
   * يقفل الموظفة أولاً حتى تتسلسل إدخالات التواريخ المختلفة وحساب تاريخ السريان التالي.
   *
   * @param employeeId هوية الموظفة صاحبة الرواتب
   */
  lockEmployee(employeeId: string): Promise<void>;
  /**
   * يقفل هوية الراتب على تاريخ السريان قبل قراءة مراجعته المحفوظة.
   *
   * @param employeeId هوية الموظفة صاحبة الراتب
   * @param effectiveFrom تاريخ سريان الراتب بصيغة YYYY-MM-DD
   */
  lockSalaryIdentity(employeeId: string, effectiveFrom: string): Promise<void>;
  /**
   * يرجع نشاط الموظفة الثابت لأحداث الراتب القديمة التي لا تحمل business_id.
   *
   * @param companyId هوية الشركة صاحبة الموظفة
   * @param employeeId هوية الموظفة المطلوب قراءة نشاطها
   */
  employeeBusiness(companyId: string, employeeId: string): Promise<string | null>;
  /**
   * يرجع صف الراتب المحفوظ للمخفّض وفحص ثبات هوية النشاط.
   *
   * @param employeeId هوية الموظفة صاحبة الراتب
   * @param effectiveFrom تاريخ سريان الراتب المطلوب قراءته
   */
  readSalary(
    employeeId: string,
    effectiveFrom: string,
  ): Promise<CommissionSalaryProjectionRow | null>;
  /**
   * يرجع أقرب تاريخ سريان لاحق ليحدد نهاية الشهور التي يغطيها الراتب.
   *
   * @param employeeId هوية الموظفة صاحبة الرواتب
   * @param effectiveFrom تاريخ السريان الذي يليه البحث
   */
  readNextEffectiveFrom(employeeId: string, effectiveFrom: string): Promise<string | null>;
  /**
   * يرجع توقيت النشاط وتاريخ إنشائه لحساب الشهر الحالي وأول شهر مسموح.
   *
   * @param companyId هوية الشركة صاحبة النشاط
   * @param businessId هوية النشاط المطلوب قراءة تقويمه
   */
  businessCalendar(
    companyId: string,
    businessId: string,
  ): Promise<{ readonly timeZone: string; readonly createdAt: Date } | null>;
  /**
   * يقفل الشهور المتأثرة والمرشحة ويرجع حالاتها المؤكدة قبل أي كتابة.
   *
   * @param input النشاط والشهور ومولّد هويات الكشوف الجديدة
   */
  lockPeriods(input: CommissionPeriodLockInput): Promise<readonly LockedCommissionPeriod[]>;
  /**
   * يدرج الراتب أو يحدّث مبلغه ومراجعته فقط مع هوية صف جديد محقونة.
   *
   * @param row صف الراتب الأحدث وهوية الصف المولّدة للإدراج
   */
  upsertSalary(row: CommissionSalaryProjectionWrite): Promise<void>;
  /**
   * يرجع شهور REVIEWED المتأثرة فقط إلى DRAFT بعد تغيّر مدخلاتها.
   *
   * @param input النشاط والشهور المتأثرة المطلوب إعادة فتحها
   */
  reopenReviewed(input: CommissionPeriodReopenInput): Promise<void>;
}
