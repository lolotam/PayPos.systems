import type { AttendanceStatementDocument, AttendanceStatementLabels } from '@pospay/contracts';
import { attendanceHoursMinutes, type AttendanceStatementDay } from '@pospay/domain';
import type { Locale } from '@pospay/i18n';

import {
  formatClockTime,
  formatIssuedAt,
  formatLocalDate,
} from './attendance-statement-display.ts';
import { statementLabels } from './attendance-statement-labels.ts';
import type {
  BranchStatementBody,
  EmployeeStatementBody,
  StatementBody,
  StatementLogoDocument,
  StatementTotals,
} from './statement-ports.ts';

type BranchDocument = Extract<AttendanceStatementDocument, { form: 'BRANCH' }>;
type EmployeeDocument = Extract<AttendanceStatementDocument, { form: 'EMPLOYEE' }>;

/** مدخلات بناء البيان: جسمه والشعار ولحظة التجهيز (FR-014). */
export interface StatementDocumentInput {
  readonly statement: StatementBody;
  readonly logo: StatementLogoDocument | null;
  readonly issuedAt: Date;
}

/** الأجزاء المشتركة بين النموذجين: اللغة ووقت الإصدار والعناوين. */
interface StatementCommon {
  readonly language: Locale;
  readonly issued_at: string;
  readonly labels: AttendanceStatementLabels;
}

/**
 * بيبني مستند البيان المطبوع من جسمه: الدقائق بتتحول لساعات، والتواريخ والأوقات
 * بصيغ عرض بلغة الطلب، ومفيش أي معرّف ولا رقم هاتف بيوصل المستند (FR-014).
 *
 * @param input جسم البيان والشعار ولحظة التجهيز
 * @returns مستند البيان جاهز للطباعة
 */
export function buildAttendanceStatementDocument(
  input: StatementDocumentInput,
): AttendanceStatementDocument {
  const statement = input.statement;
  const common: StatementCommon = {
    language: statement.language,
    issued_at: formatIssuedAt(input.issuedAt, statement.language, statement.timezone),
    labels: statementLabels(statement.language),
  };
  if (statement.form === 'BRANCH') return branchDocument(statement, input.logo, common);
  return employeeDocument(statement, input.logo, common);
}

/**
 * نموذج الفرع: رأس فيه الموظفة المفلترة وزوج الوردية، وجدول صفوف الموظفات (BR-03 و BR-11).
 *
 * @param statement جسم نموذج الفرع
 * @param logo الشعار أو null
 * @param common اللغة ووقت الإصدار والعناوين
 * @returns مستند نموذج الفرع
 */
function branchDocument(
  statement: BranchStatementBody,
  logo: StatementLogoDocument | null,
  common: StatementCommon,
): BranchDocument {
  const timezone = statement.timezone;
  return {
    form: 'BRANCH',
    language: common.language,
    issued_at: common.issued_at,
    labels: common.labels,
    header: {
      business_name: statement.businessName,
      branch_name: statement.branchName,
      logo,
      period: {
        from: formatLocalDate(statement.period.from, common.language, timezone),
        to: formatLocalDate(statement.period.to, common.language, timezone),
      },
      employee_filter: employeeFilter(statement),
      shift_filter: shiftFilter(statement),
    },
    rows: statement.rows.map((row) => ({
      employee_number: row.employeeNumber,
      name: row.name,
      totals: documentTotals(row.totals),
    })),
  };
}

/**
 * نموذج الموظفة: رأس فيه بياناتها، وجدول الأيام، وكتلة أرقامها (Story 2).
 *
 * @param statement جسم نموذج الموظفة
 * @param logo الشعار أو null
 * @param common اللغة ووقت الإصدار والعناوين
 * @returns مستند نموذج الموظفة
 */
function employeeDocument(
  statement: EmployeeStatementBody,
  logo: StatementLogoDocument | null,
  common: StatementCommon,
): EmployeeDocument {
  const timezone = statement.timezone;
  return {
    form: 'EMPLOYEE',
    language: common.language,
    issued_at: common.issued_at,
    labels: common.labels,
    header: {
      business_name: statement.businessName,
      branch_name: statement.branchName,
      logo,
      period: {
        from: formatLocalDate(statement.period.from, common.language, timezone),
        to: formatLocalDate(statement.period.to, common.language, timezone),
      },
      employee: {
        name: statement.employee.name,
        employee_number: statement.employee.employeeNumber,
      },
    },
    totals: documentTotals(statement.totals),
    days: statement.days.map((day) => documentDay(day, common.language, timezone)),
  };
}

/**
 * الموظفة المفلترة في رأس بيان الفرع؛ null لما البيان لكل الفرع (BR-03).
 *
 * @param statement جسم نموذج الفرع
 * @returns الموظفة المفلترة أو null
 */
function employeeFilter(statement: BranchStatementBody) {
  const employee = statement.employeeFilter;
  if (employee === null) return null;
  return { name: employee.name, employee_number: employee.employeeNumber };
}

/**
 * زوج الوردية المطبّق في رأس بيان الفرع؛ null لما مفيش فلتر (BR-11).
 *
 * @param statement جسم نموذج الفرع
 * @returns زوج البداية والنهاية أو null
 */
function shiftFilter(statement: BranchStatementBody) {
  const shift = statement.shiftFilter;
  if (shift === null) return null;
  return { start: shift.start.slice(0, 5), end: shift.end.slice(0, 5) };
}

/**
 * الساعات بصيغة h:mm؛ المتعاقد والفرق الفاضيين يفضلوا فاضيين مع فلتر الشيفت (BR-11).
 *
 * @param minutes دقائق الموظفة أو null
 * @returns الساعات بصيغة h:mm أو null
 */
function hoursOrNull(minutes: number | null): string | null {
  if (minutes === null) return null;
  return attendanceHoursMinutes(minutes);
}

/**
 * أرقام الموظفة بصيغ العقد: الساعات h:mm، والتعاقد والفرق فاضيين مع فلتر الشيفت (BR-11).
 *
 * @param totals أرقام الموظفة بالدقائق
 * @returns خلايا الأرقام بصيغ العقد
 */
function documentTotals(totals: StatementTotals) {
  return {
    days_present: totals.daysPresent,
    worked_hours: attendanceHoursMinutes(totals.workedMinutes),
    scheduled_hours: attendanceHoursMinutes(totals.scheduledMinutes),
    contracted_hours: hoursOrNull(totals.contractedMinutes),
    difference_hours: hoursOrNull(totals.differenceMinutes),
    leave: totals.leave.map((entry) => ({
      type: entry.type,
      days: entry.days,
      partial_hours: attendanceHoursMinutes(entry.partial_minutes),
    })),
    late_count: totals.lateCount,
    late_minutes: totals.lateMinutes,
    missing_clock_out: totals.missingClockOut,
    manual_days: totals.manualDays,
  };
}

/**
 * يوم واحد بصيغ العقد: أوقات البصمة بالساعة والدقيقة، وساعات اليوم، والملاحظات (FR-014).
 *
 * @param day يوم العمل كما جا من packages/domain
 * @param language لغة الطلب
 * @param timezone منطقة الفرع
 * @returns صف اليوم بصيغ العقد
 */
function documentDay(day: AttendanceStatementDay, language: Locale, timezone: string) {
  return {
    date: formatLocalDate(day.date, language, timezone),
    sessions: day.sessions.map((session) => ({
      clock_in: formatClockTime(new Date(session.clock_in), language, timezone),
      clock_out:
        session.clock_out === null
          ? null
          : formatClockTime(new Date(session.clock_out), language, timezone),
      late_minutes: session.late_minutes,
      manual: session.manual,
      missing_clock_out: session.missing_clock_out,
    })),
    worked_hours: attendanceHoursMinutes(day.worked_minutes),
    still_in: day.still_in,
    leave: [...day.leave],
    scheduled: day.scheduled.map((shift) => ({
      start: formatClockTime(new Date(shift.starts_at), language, timezone),
      end: formatClockTime(new Date(shift.ends_at), language, timezone),
    })),
    no_attendance: day.no_attendance,
  };
}
