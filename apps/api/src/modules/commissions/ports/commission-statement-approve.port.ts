import type { StatementAttachmentRow, StatementRow } from '@pospay/commissions-engine';

import type { PlannedCarry, ShareCheckLine } from '../domain/approval-plan.ts';
import type { ExpectedCoverageRules, StoredCoverageProof } from '../domain/coverage-proof.ts';
import type { EmploymentDates } from '../domain/employment-overlap.ts';
import type { CommissionStatementSource } from './commission-statement.port.ts';

/** ما يُدقَّق عند الاعتماد: البصمتان وعدد الصفوف والمرحّلات، بلا أي مبلغ ولا اسم. */
export interface ApprovalAuditDetail {
  readonly inputFingerprint: string;
  readonly statementFingerprint: string;
  readonly rows: number;
  readonly carries: number;
}

/** طلب الاعتماد بهوية الفاعل والبصمتين اللي شافهما المراجع ومفتاح إعادة الإرسال وبصمة الطلب. */
export interface CommissionStatementApproveCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly period: string;
  readonly expectedFingerprint: string;
  readonly expectedStatementFingerprint: string;
  readonly key: string;
  readonly fingerprint: string;
}

/** شهر مقفول بحالته ومعرّف كشفه، كما رجع من نداء القفل الواحد. */
export interface ApprovalLockedPeriod {
  readonly period: string;
  readonly statementId: string;
  readonly status: 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID';
}

/**
 * ما تقرأه بوابة التغطية تحت قفل صف الحالة (ADR-0054 §7 الخطوة 5): الإثبات الحالي لو وُجد، وهل مفتاح الاعتماد
 * الصريح للشركة مفتوح، وثوابت الملف التنفيذي وهوية قاعدة البيانات الحالية للمقارنة.
 */
export interface CoverageGateRead {
  readonly proof: StoredCoverageProof | null;
  readonly switchEnabled: boolean;
  readonly expected: ExpectedCoverageRules;
}

/** صفوف الكشف المجمّد وارتباطاته كما قُرئت بعد التجميد في نفس المعاملة. */
export interface FrozenStatementRead {
  readonly rows: readonly StatementRow[];
  readonly attachments: readonly StatementAttachmentRow[];
}

/** مرحّل سيُكتب مع شهر الكشف المصدر والشهر الهدف المختار بحسب D-13. */
export interface CarryWrite extends PlannedCarry {
  readonly targetPeriod: string;
  readonly targetStatementId: string;
}

/** بيانات تحديث صف الكشف إلى APPROVED في أمر واحد (FR-034). */
export interface ApprovalStamp {
  readonly statementId: string;
  readonly inputFingerprint: string;
  readonly statementFingerprint: string;
}

/** خطوات الاعتماد جوّه معاملة شركة واحدة، بالترتيب الذي تستدعيه به حالة الاستخدام. */
export interface CommissionStatementApproveScope {
  /**
   * يلتقط بداية معاملة قاعدة البيانات نصًّا بلا فقد دقة، قبل أي انتظار (ADR-0012 §1): نص لأن `Date` في
   * جافاسكربت يقص الميكروثواني فترفضه دالة العدّ.
   *
   * @returns `transaction_timestamp()` كنص
   */
  cutoff(): Promise<string>;
  /**
   * اليوم المحلي للنشاط بصيغة YYYY-MM-DD (من ساعة الخدمة وتوقيت النشاط)، أو null لو النشاط غير موجود.
   *
   * @returns تاريخ اليوم المحلي أو null
   */
  localToday(): Promise<string | null>;
  /**
   * حالة صف الكشف المخزّن بقراءة بلا قفل، قبل أي قفل شهور (يعاد فحصها بعد القفل): تمنع أن يولّد طلب لشهر قديم جدًا
   * صف قفل لكل شهر حتى اليوم قبل أن يُرفض لأن الكشف غير REVIEWED.
   *
   * @param period الشهر بصيغة YYYY-MM
   * @returns حالة الكشف أو null لو لم يُنشأ كشف لهذا الشهر
   */
  readStatementStatus(period: string): Promise<'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID' | null>;
  /**
   * يعيد فحص صلاحية الاعتماد وقراءة النشاط كله وميزة العمولات.
   *
   * @returns FORBIDDEN أو FEATURE_DISABLED أو null عند السماح
   */
  recheckAccess(): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  /**
   * يقفل الشهور المطلوبة في نداء واحد تصاعدي وينشئ صف DRAFT لأي شهر ناقص، ويرجّع حالاتها بعد اكتمال الانتظار.
   *
   * @param periods الشهور بصيغة YYYY-MM
   * @returns الشهور المقفولة بحالاتها
   */
  lockPeriods(periods: readonly string[]): Promise<readonly ApprovalLockedPeriod[]>;
  /**
   * بوابة التغطية: تضمن صف الحالة وتأخذه FOR SHARE إلى نهاية المعاملة، ثم تقرأ الإثبات الحالي ومفتاح
   * الاعتماد الصريح في عبارة لاحقة (ADR-0054 §7 الخطوة 5).
   *
   * @returns الإثبات ومفتاح الاعتماد وثوابت المقارنة
   */
  readCoverageGate(): Promise<CoverageGateRead>;
  /**
   * يقرأ مصادر الكشف بعد القفل، مرة واحدة تغذي مقارنة ما قبل التجميد والتجميد نفسه (FR-032).
   *
   * @param period الشهر بصيغة YYYY-MM
   * @returns مصادر الكشف
   */
  readSource(period: string): Promise<CommissionStatementSource>;
  /**
   * صفوف حصص مؤدي البنود في الشهر لفحص D-14 الدفاعي.
   *
   * @param period الشهر بصيغة YYYY-MM
   * @returns صف لكل مؤدية
   */
  readLineShares(period: string): Promise<readonly ShareCheckLine[]>;
  /**
   * عدّاد الأحداث المعلّقة لهذه الشركة قبل لحظة البداية الملتقطة (ADR-0012).
   *
   * @param cutoff لحظة البداية كنص من `cutoff()`
   * @returns عدد الأحداث بلا علامة استهلاك
   */
  countPendingEvents(cutoff: string): Promise<number>;
  /**
   * تواريخ عمل الموظفات المطلوبات من قارئ الموظفين، لقاعدة «الراحلة لا يُعاد ترحيلها».
   *
   * @param employeeIds الموظفات
   * @returns تواريخ كل موظفة
   */
  readEmployment(employeeIds: readonly string[]): Promise<ReadonlyMap<string, EmploymentDates>>;
  /**
   * يحدّث صف الكشف إلى APPROVED في أمر واحد بالمعتمِد وبصمتي المدخلات والكشف (FR-034).
   *
   * @param stamp معرّف الكشف والبصمتان
   * @returns اكتمال التحديث
   */
  markApproved(stamp: ApprovalStamp): Promise<void>;
  /**
   * يدخل صفوف الباني كما بُنيت وارتباطات الموظفات في إدخال واحد لكل جدول (FR-033).
   *
   * @param statementId الكشف المعتمَد
   * @param rows صفوف الباني
   * @param attachments لقطة ارتباطات الفروع
   * @returns اكتمال التجميد
   */
  freeze(
    statementId: string,
    rows: readonly StatementRow[],
    attachments: readonly StatementAttachmentRow[],
  ): Promise<void>;
  /**
   * يقرأ الصفوف المجمّدة وارتباطاتها لإعادة حساب بصمة الكشف منها في نفس المعاملة.
   *
   * @param statementId الكشف المعتمَد
   * @returns الصفوف والارتباطات
   */
  readFrozen(statementId: string): Promise<FrozenStatementRead>;
  /**
   * يكتب مرحّلات الأرصدة السالبة بكشف المصدر وكشف الهدف.
   *
   * @param statementId كشف المصدر الذي اعتُمد
   * @param period شهر المصدر
   * @param carries المرحّلات وأهدافها
   * @returns اكتمال الكتابة
   */
  writeCarries(statementId: string, period: string, carries: readonly CarryWrite[]): Promise<void>;
  /**
   * يكتب تدقيق `commission_statement.approved` بلا أي مبلغ أو اسم.
   *
   * @param statementId الكشف المعتمَد
   * @param period الشهر
   * @param detail ما يُدقَّق: البصمتان وعدد الصفوف والمرحّلات
   * @returns اكتمال التدقيق
   */
  audit(statementId: string, period: string, detail: ApprovalAuditDetail): Promise<void>;
  /**
   * وقت الاعتماد المخزّن على صف الكشف، كنص ISO بالـoffset، لرد الاعتماد.
   *
   * @param statementId الكشف المعتمَد
   * @returns وقت الاعتماد
   */
  readApprovedAt(statementId: string): Promise<string>;
}

/** حد المعاملة الذرية وإعادة الإرسال لاعتماد الكشف. */
export interface CommissionStatementApproveTransactions {
  /**
   * ينفذ الفحوص والأقفال والتجميد مع مطالبة idempotent في معاملة شركة واحدة. الفحص الأول والإعادة المخزّنة
   * مصرّح بهما قبل أي رد، وأي رفض يلغي كل ما كُتب بما فيه ضمان صف الحالة.
   *
   * @param command هوية الفاعل والطلب ومفتاح إعادة الإرسال
   * @param work خطوات حالة الاستخدام على المعاملة
   * @returns نتيجة العمل أو جسم الرد المخزّن
   */
  run<T>(
    command: CommissionStatementApproveCommand,
    work: (scope: CommissionStatementApproveScope) => Promise<T>,
  ): Promise<T>;
}
