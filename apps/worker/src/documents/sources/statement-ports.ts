import type { AttendanceLeaveSummary, AttendanceStatementDay } from '@pospay/domain';

/** أرقام الموظفة في الفترة؛ كلها دقائق، والتعاقد والفرق بيبقوا فاضيين مع فلتر الشيفت (BR-11). */
export interface StatementTotals {
  readonly daysPresent: number;
  readonly workedMinutes: number;
  readonly scheduledMinutes: number;
  readonly contractedMinutes: number | null;
  readonly differenceMinutes: number | null;
  readonly leave: AttendanceLeaveSummary;
  readonly lateCount: number;
  readonly lateMinutes: number;
  readonly missingClockOut: number;
  readonly manualDays: number;
}

/** الرأس المشترك بين النموذجين: اللغة والمنطقة واسم النشاط واسم الفرع والفترة. */
export interface StatementHeader {
  readonly language: 'ar' | 'en';
  readonly timezone: string;
  readonly businessName: string;
  readonly branchName: string;
  readonly period: { readonly from: string; readonly to: string };
}

/** نموذج الفرع: الموظفة المفلترة وزوج الوردية وصفوف الموظفات. */
export interface BranchStatementBody extends StatementHeader {
  readonly form: 'BRANCH';
  readonly employeeFilter: { readonly name: string; readonly employeeNumber: number } | null;
  readonly shiftFilter: { readonly start: string; readonly end: string } | null;
  readonly rows: readonly {
    readonly employeeNumber: number;
    readonly name: string;
    readonly totals: StatementTotals;
  }[];
}

/** نموذج الموظفة: بياناتها وأرقامها وصفوف الأيام. */
export interface EmployeeStatementBody extends StatementHeader {
  readonly form: 'EMPLOYEE';
  readonly employee: { readonly name: string; readonly employeeNumber: number };
  readonly totals: StatementTotals;
  readonly days: readonly AttendanceStatementDay[];
}

/** جسم البيان: نموذج الفرع ولا نموذج الموظفة. */
export type StatementBody = BranchStatementBody | EmployeeStatementBody;

/** بيانات البيان كما بترجع من القارئ؛ الأرقام والمعرّفات بتتقفل جوه المصدر (FR-014). */
export interface StatementData {
  readonly businessId: string;
  readonly requesterUserId: string;
  readonly logoFileId: string | null;
  readonly statement: StatementBody;
}

/** نتيجة القراءة: جاهز بأرقامه، أو فاضي لأن مفيش تغطية في الفترة (FR-013a). */
export type StatementRead = { kind: 'EMPTY' } | { kind: 'READY'; data: StatementData };

/** طلب قراءة الشعار: النشاط والملف ومَن طلبه ومعرّف الرندر. */
export interface StatementLogoRequest {
  readonly businessId: string;
  readonly fileId: string;
  readonly requesterUserId: string;
  readonly renderId: string;
}

/** الشعار بعد التصغير: بايتاته ونوعه. */
export interface StatementLogo {
  readonly content_type: 'image/png' | 'image/jpeg';
  readonly bytes: Uint8Array;
}

/** قارئ الشعار: بيرجّع الشعار أو null لما الملف مش موجود أو مش مؤهّل. */
export type StatementLogoReader = (
  companyId: string,
  request: StatementLogoRequest,
  signal?: AbortSignal,
) => Promise<StatementLogo | null>;

/** ساعة المصدر؛ الوقت بيجي من المحرك مش من ساعة الجهاز (FR-016). */
export interface StatementClock {
  now(): Date;
}

/** اعتماديات مصدر البيان: قارئ البيان وقارئ الشعار والساعة، وكلها محقونة من composition root. */
export interface AttendanceStatementSourceDeps {
  readonly readStatement: (
    companyId: string,
    renderId: string,
    signal?: AbortSignal,
  ) => Promise<StatementRead>;
  readonly readLogo: StatementLogoReader;
  readonly clock: StatementClock;
}

/** الشعار جاهز للتضمين في العقد: نوعه ونصه Base64 (FR-014). */
export interface StatementLogoDocument {
  readonly content_type: 'image/png' | 'image/jpeg';
  readonly base64: string;
}
