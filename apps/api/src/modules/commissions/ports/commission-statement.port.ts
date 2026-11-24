import type {
  CommissionEstimateAttachment,
  OpenBlockedCorrection,
  StatementRow,
  StatementEmployeeLabel,
  StatementLineHead,
  StatementMonthRows,
  StatementNames,
} from '@pospay/commissions-engine';

import type { StatementFingerprints } from '../domain/statement-change-cause.ts';

/** حالة الكشف المخزّنة ببصماتها؛ `null` يعني مفيش صف كشف للشهر ده لسه. */
export interface CommissionStatementRecord {
  readonly status: 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID';
  /** بصمة المدخلات اللي آخر generate خزّنها؛ `null` يعني الكشف ما اتولدش (research R6). */
  readonly currentFingerprint: string | null;
  readonly reviewedFingerprint: string | null;
  readonly reviewedStatementFingerprint: string | null;
}

/**
 * كل ما الكشف وبصماته محتاجينه، مقروء من لقطة واحدة: صفوف الشهر بكل موظفاته، والتصحيحات الموقوفة
 * المفتوحة، وبطاقات الموظفات وارتباطاتهن، والأسماء الكاملة، ورؤوس البنود لتصحيحاتها، وصف الكشف.
 */
export interface CommissionStatementSource {
  readonly statement: CommissionStatementRecord | null;
  readonly employees: readonly StatementEmployeeLabel[];
  readonly attachments: readonly CommissionEstimateAttachment[];
  readonly month: StatementMonthRows;
  readonly blocked: readonly OpenBlockedCorrection[];
  /** موظفات برا مجموعة الكشف وعليهن تصحيح موقوف مفتوح، بطاقاتهن؛ مش جزء من صفوف الباني ولا من بصمة الكشف. */
  readonly unlisted: readonly StatementEmployeeLabel[];
  readonly names: StatementNames;
  readonly correctionLineDetails: ReadonlyMap<string, StatementLineHead>;
}

/** صرف كشف PAID كما اتخزّن: أعمدة الصرف وصف الدفع لكل موظفة مجمّدة، والمبالغ نصوص KWD (FR-037). */
export interface ClosedStatementPayment {
  readonly paidOn: string;
  readonly paidMethod: 'WITH_SALARY' | 'BANK_TRANSFER' | 'CASH';
  readonly paidNote: string | null;
  readonly paidAt: string;
  readonly paidBy: string;
  readonly payments: readonly {
    readonly employeeId: string;
    readonly exactPayable: string;
    readonly paidAmount: string;
  }[];
}

/**
 * ما يخزّنه الاعتماد والصرف وتحتاجه قراءة شهر مغلق: وقت الاعتماد والبصمتان المجمّدتان والصفوف المجمّدة، وبيانات
 * الصرف لما يكون الشهر PAID وإلا null (FR-025، FR-037).
 */
export interface ClosedStatementRead {
  readonly approvedAt: string;
  readonly inputFingerprint: string;
  readonly statementFingerprint: string;
  readonly rows: readonly StatementRow[];
  readonly payment: ClosedStatementPayment | null;
}

/** نطاق القارئ كما حله قارئ identity، مع الكشف المقروء في نفس اللقطة. */
export interface CommissionStatementRead {
  /** القارئ على مستوى النشاط كله ولا على فروع محددة. */
  readonly businessWide: boolean;
  readonly branchIds: readonly string[];
  readonly source: CommissionStatementSource;
  /** الصفوف المجمّدة لشهر APPROVED أو PAID، وإلا null: العرض الحي لا يُحسب لشهر اتجمّد. */
  readonly closed: ClosedStatementRead | null;
}

/**
 * قارئ الكشف: بيفتح معاملة قراءة فقط ويقرا كل المدخلات في لقطة واحدة (D-25). مفيش كاتب ولا قفل ولا
 * صف بيتعمل، والمعاملة كلها جوّه المحوّل علشان البورت ما يعرفش الداتابيز.
 */
export interface CommissionStatementReader {
  /**
   * بيفتح معاملة القراءة ويحل نطاق القارئ ويقرا مصادر كشف الشهر.
   *
   * @param input طلب القراءة
   * @param input.companyId الشركة المؤكدة
   * @param input.userId المستخدم البشري الفاعل
   * @param input.businessId النشاط المطلوب
   * @param input.period الشهر بصيغة YYYY-MM
   * @returns المصادر مع نطاق القارئ، أو سبب الرفض
   */
  read(input: {
    readonly companyId: string;
    readonly userId: string;
    readonly businessId: string;
    readonly period: string;
  }): Promise<
    | { readonly kind: 'ok'; readonly read: CommissionStatementRead }
    | { readonly kind: 'forbidden' }
    | { readonly kind: 'feature_disabled' }
  >;
}

/** طلب إنشاء الكشف بهوية الفاعل ومفتاح إعادة الإرسال وبصمة الطلب. */
export interface CommissionStatementGenerateCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly period: string;
  readonly key: string;
  readonly fingerprint: string;
}

/** خطوات الكتابة اللي بتحتاجها حالة استخدام الإنشاء جوّه معاملة شركة واحدة. */
export interface CommissionStatementGenerateScope {
  /**
   * بيرجّع توقيت النشاط لتحديد اليوم المحلي اللي عليه نقرر انتهاء الشهر.
   *
   * @returns التوقيت، أو null عند غياب النشاط
   */
  timeZone(): Promise<string | null>;
  /**
   * بيقفل كشف الشهر في نداء واحد بعد ما ينشئ صف DRAFT لو مش موجود، ويرفض APPROVED وPAID.
   *
   * @param period الشهر المطلوب
   * @returns اكتمال القفل وفحص الشهر المفتوح
   */
  lockPeriod(period: string): Promise<void>;
  /**
   * بيعيد فحص «الإنشاء والمراجعة» وميزة العمولات بعد أقفال الشهر.
   *
   * @returns FORBIDDEN أو FEATURE_DISABLED أو null عند السماح
   */
  recheckAccess(): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  /**
   * بيقرا مصادر الكشف بعد القفل، في نفس معاملة الكتابة.
   *
   * @param period الشهر المطلوب
   * @returns مصادر الكشف
   */
  readSource(period: string): Promise<CommissionStatementSource>;
  /**
   * بيخزّن بصمة المدخلات الحالية على صف الكشف المقفول من غير ما يلمس الحالة ولا بيانات المراجعة.
   *
   * @param period الشهر المطلوب
   * @param fingerprint بصمة المدخلات
   * @returns اكتمال التحديث
   */
  storeCurrentFingerprint(period: string, fingerprint: string): Promise<void>;
  /**
   * بيكتب تدقيق `commission_statement.generated` من غير أي مبلغ ولا اسم.
   *
   * @param period الشهر المطلوب
   * @param fingerprints البصمتان اللي اتخزّنت واللي الباني طلّعها
   * @returns اكتمال التدقيق
   */
  audit(period: string, fingerprints: StatementFingerprints): Promise<void>;
}

/** حد المعاملة الذرية وإعادة الإرسال لإنشاء الكشف. */
export interface CommissionStatementGenerateTransactions {
  /**
   * ينفذ الفحص والأقفال والكتابة والتدقيق مع مطالبة idempotent في معاملة شركة واحدة. لو انتهى انتظار
   * المطالبة بخطأ الانشغال فالمعاملة بتتلغي وبتتقرا الصلاحية مرة كمان في معاملة منفصلة قبل الرد.
   *
   * @param command هوية الفاعل والطلب ومفتاح إعادة الإرسال
   * @param work خطوات حالة الاستخدام على المعاملة
   * @returns نتيجة العمل أو جسم الرد المخزّن
   */
  run<T>(
    command: CommissionStatementGenerateCommand,
    work: (scope: CommissionStatementGenerateScope) => Promise<T>,
  ): Promise<T>;
}
