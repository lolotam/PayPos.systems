import type {
  AttendanceLeaveSummary,
  AttendanceOpenSession,
  AttendancePeriod,
  AttendanceShiftPair,
  AttendanceStatementDay,
  BusinessDisplayNames,
  ReportBranchInputs,
  StatementLanguage,
  StoredBusinessIdentity,
} from '@pospay/domain';

/** نتيجة قراءة البيان: جاهز بأرقامه، أو فاضي لأن مفيش تغطية في الفترة (FR-013a). */
export type AttendanceStatementRead =
  { kind: 'EMPTY' } | { kind: 'READY'; data: AttendanceStatementData };

/** بيانات البيان كما بتطلع من القارئ؛ الشعار ورقم النشاط ورقم الطالب بياكلم بره القالب. */
export interface AttendanceStatementData {
  /** النشاط؛ بيستعمل بس لاستدعاء قارئ الشعار، وبيوصلش القالب. */
  businessId: string;
  /** المستخدم اللي طلب البيان؛ بيتسجل معاه كل وصول لملف. */
  requesterUserId: string;
  /** الملف اللي اتربط وقت الطلب؛ null يعني إن مفيش شعار. */
  logoFileId: string | null;
  /** جسم البيان: رأسه وجدوله. */
  statement: AttendanceStatementBody;
}

/** جسم البيان: نموذج الفرع أو نموذج الموظفة. */
export type AttendanceStatementBody = BranchStatementBody | EmployeeStatementBody;

/** رأس البيان المشترك بين النموذجين: اللغة والمنطقة والاسم والفترة. */
export interface StatementHeader {
  /** لغة الطلب؛ الأسماء بتتقري بلغة الطلب. */
  language: 'ar' | 'en';
  /** المنطقة الفعّالة: منطقة الفرع وإلا منطقة النشاط؛ المصدر بيصيغ التواريخ بيها. */
  timezone: string;
  /** اسم رأس النشاط: الرسمي بلغة الطلب، واسم العرض لو مفيش رسمي. */
  businessName: string;
  /** اسم الفرع بلغة الطلب؛ الإنجليزي هو الملجأ. */
  branchName: string;
  /** فترة التقرير بالأيام؛ الطرفين مشمولين. */
  period: { from: string; to: string };
}

/** أرقام الموظفة في الفترة؛ كلها دقائق صحيحة، والتعاقد والفرق بيبقوا فاضيين مع فلتر الشيفت. */
export interface StatementTotals {
  daysPresent: number;
  workedMinutes: number;
  scheduledMinutes: number;
  /** الساعات التعاقدية؛ null مع فلتر الشيفت لأنها مش مرتبطة بشيفت (BR-11). */
  contractedMinutes: number | null;
  /** الفرق بين العمل والتعاقد؛ null مع فلتر الشيفت. */
  differenceMinutes: number | null;
  /** الإجازة المعتمدة بالنوع؛ أيام ودقائق جزئية. */
  leave: AttendanceLeaveSummary;
  lateCount: number;
  lateMinutes: number;
  missingClockOut: number;
  manualDays: number;
}

/** بيان الفرع: صف لكل موظفة ليها تغطية في الفرع والفترة. */
export interface BranchStatementBody extends StatementHeader {
  form: 'BRANCH';
  /** الموظفة المفلترة لو الطلب كان عليها؛ null لو البيان لكل الفرع. */
  employeeFilter: { name: string; employeeNumber: number } | null;
  /** زوج الشيفت المطبّق؛ null لو مفيش فلتر. */
  shiftFilter: { start: string; end: string } | null;
  /** صفوف الموظفات مرتبة برقم الموظفة. */
  rows: { employeeNumber: number; name: string; totals: StatementTotals }[];
}

/** بيان الموظفة: يوم بيوم في الفترة وبعدين أرقامها. */
export interface EmployeeStatementBody extends StatementHeader {
  form: 'EMPLOYEE';
  employee: { name: string; employeeNumber: number };
  totals: StatementTotals;
  /** صف لكل يوم في الفترة؛ ترتيب التاريخ. */
  days: AttendanceStatementDay[];
}

/** صف طلب البيان كما هو في جدول الطلبات: معلماته ولحظة طلبه. */
export interface AttendanceStatementRequestRow {
  readonly businessId: string;
  readonly branchId: string;
  readonly form: 'BRANCH' | 'EMPLOYEE';
  readonly employeeId: string | null;
  readonly period: AttendancePeriod;
  readonly language: StatementLanguage;
  /** زوج الشيفت المطبّق؛ null لو مفيش فلتر. */
  readonly shift: AttendanceShiftPair | null;
  readonly logoFileId: string | null;
  readonly requesterUserId: string;
  /** لحظة الطلب بلغة ISO؛ دي حدّ القطع لكل أرقام الجدولة (FR-013a). */
  readonly requestedAt: string;
}

/** صف موظفة كما يقرؤه تقرير 27b أو جملة الموظفات المجدول بس. */
export interface AttendanceStatementRow {
  readonly employee_id: string;
  readonly name_ar: string | null;
  readonly name_en: string;
  readonly employee_number: number;
  readonly branches: readonly ReportBranchInputs[];
}

/** أسماء النشاط والفرع والمنطقة الفعّالة كما تتفرا في معاملة الطلب. */
export interface AttendanceStatementNames {
  readonly business: BusinessDisplayNames;
  readonly branch: { readonly nameAr: string | null; readonly nameEn: string };
  readonly timezone: string;
}

/** كل مدخلات البيان الخام؛ بتتفرا كلها في معاملة قراءة واحدة قبل أي حساب. */
export interface StatementInputs {
  readonly request: AttendanceStatementRequestRow;
  readonly names: AttendanceStatementNames;
  readonly identity: StoredBusinessIdentity;
  /** مرشحو تقرير 27b: الموظفات اللي عندهن جلسة أو دقائق تعاقدية. */
  readonly reportRows: readonly AttendanceStatementRow[];
  /** الموظفات المجدول بس: تغطية وردية بلا جلسة ولا عقد. */
  readonly scheduledRows: readonly AttendanceStatementRow[];
  /** جلسات الموظفة المفتوحة في الفترة؛ بتطبع «لسه جوّه» وبتتحسبش في أي رقم (FR-011a). */
  readonly openSessions: readonly AttendanceOpenSession[];
}
