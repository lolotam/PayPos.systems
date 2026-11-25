import type { AlertKind, EffectiveAlertRule } from '@pospay/domain';
import type { CommissionActionPermission } from '@pospay/domain';

/** نشاط من أنشطة الشركة مع منطقته الزمنية (FR-053). */
export interface StatementReminderBusiness {
  readonly id: string;
  readonly timeZone: string;
}

/** حالة كشف الشهر المقفول: هويته وحالته بعد القفل. */
export interface LockedReminderStatement {
  readonly statementId: string;
  readonly status: 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID';
}

/** نوع سطر دفتر التذكيرات: مراجعة اليوم الثالث واعتماد اليومين الثالث والخامس. */
export type ReminderLedgerKind = 'REVIEW_DAY3' | 'APPROVAL_DAY3' | 'APPROVAL_DAY5';

/** مدخلات سطر دفتر التذكيرات: النشاط والكشف والنوع والتاريخ وعدد المستلمين. */
export interface ReminderLedgerInput {
  readonly businessId: string;
  readonly statementId: string;
  readonly kind: ReminderLedgerKind;
  readonly reminderDate: string;
  readonly recipientCount: number;
}

/** مدخلات حدث الجرس: الكشف والنشاط والشهر والمستلمون والقالب. */
export interface NoticeEventInput {
  readonly statementId: string;
  readonly businessId: string;
  readonly period: string;
  readonly recipients: readonly string[];
  readonly templateKey: 'statement_awaiting_approval' | 'statement_awaiting_review';
}

/**
 * نطاق عمل التذكير على معاملة الشركة: كل القراءات والكتابات اللي بتتم في معاملة واحدة
 * لكل نشاط (FR-053). المسار ما يمسكش قاعدة البيانات بنفسه؛ الـpersistence بيبني النطاق.
 */
export interface StatementReminderScope {
  /** هل ميزة العمولات مفعّلة للشركة؟ */
  featureEnabled: () => Promise<boolean>;
  /** لحظة القرار من ساعة PostgreSQL بعد الأقفال (ADR-0054 §9). */
  decisionTime: () => Promise<Date>;
  /** القاعدة الفعلية لنوع التنبيه: التشغيل والقناة بس (DR-008). */
  alertRule: (businessId: string, kind: AlertKind) => Promise<EffectiveAlertRule>;
  /** هل مفتاح الشركة الصريح مفتوح؟ (53-2-B2a-FR030-1) */
  switchEnabled: (flag: string, decisionAt: Date) => Promise<boolean>;
  /** المستلمون المؤهلون بالمسند المشترك (FR-030). */
  recipients: (
    businessId: string,
    actionPermission: CommissionActionPermission,
    at: Date,
  ) => Promise<readonly string[]>;
  /** يقفل كشف الشهر (وبالتالي ينشئه لو النشاط هادي) ويقرأ حالته. */
  lockPeriod: (businessId: string, period: string) => Promise<LockedReminderStatement | null>;
  /** يكتب سطر دفتر التذكيرات؛ التكرار أيام الاستحقاق متمنوع بالمفتاح الفريد. */
  insertLedger: (input: ReminderLedgerInput) => Promise<boolean>;
  /** يكتب أحداث الجرس لمجموعات المستلمين. */
  appendNoticeEvents: (input: NoticeEventInput) => Promise<number>;
}

/** حد المعاملة: معاملة واحدة لكل نشاط مستحق (FR-053). */
export interface StatementReminderTransactions {
  /** أنشطة الشركة مع مناطقها الزمنية، في معاملة قراءة. */
  businesses: (companyId: string) => Promise<readonly StatementReminderBusiness[]>;
  /** يفتح معاملة الشركة ويبني نطاق العمل عليها. */
  run: <T>(
    companyId: string,
    work: (scope: StatementReminderScope) => Promise<T>,
  ) => Promise<T>;
}

/**
 * قارئ أنشطة الشركة: الأنشطة الحيّة مع مناطقها الزمنية، للشركة غير المحذوفة.
 */
export type StatementReminderBusinessesReader<Transaction> = (
  tx: Transaction,
  companyId: string,
) => Promise<readonly StatementReminderBusiness[]>;

/**
 * قارئ ميزة العمولات للشركة: الميزة المقفولة تخلّي التذكير ينتهي من غير أي كتابة (CM-57).
 */
export type StatementReminderFeatureReader<Transaction> = (
  tx: Transaction,
  companyId: string,
) => Promise<boolean>;

/**
 * قارئ المستلمين: أصحاب صلاحية الفعل على النشاط كله اللي شايفين النشاط كله (FR-030).
 */
export type StatementReminderRecipientsReader<Transaction> = (
  tx: Transaction,
  companyId: string,
  businessId: string,
  actionPermission: CommissionActionPermission,
  at: Date,
) => Promise<readonly string[]>;

/**
 * قارئ قواعد التنبيه: القاعدة الفعلية بتحدد التشغيل والقناة بس (DR-008).
 */
export type StatementReminderAlertRulesReader<Transaction> = (
  tx: Transaction,
  companyId: string,
  scope: { businessId: string; branchId: string | null },
  kind: AlertKind,
) => Promise<EffectiveAlertRule>;

/**
 * قارئ المفتاح الصريح للشركة: الاعتماد المقفول يخلّي مطالبة الاعتماد بلا معنى (53-2-B2a-FR030-1).
 */
export type StatementReminderSwitchReader<Transaction> = (
  tx: Transaction,
  companyId: string,
  flag: string,
  decisionAt: Date,
) => Promise<boolean>;
