import {
  computeAttendancePeriodReport,
  computeAttendanceShiftPeriodReport,
  computeAttendanceStatementDays,
  hasAttendanceStatementCoverage,
  mergeAttendanceStatementRows,
  statementIdentity,
  type AttendanceOpenSession,
  type AttendancePeriod,
  type AttendanceShiftPair,
  type ReportBranchInputs,
  type StatementLanguage,
} from '@pospay/domain';
import type {
  AttendanceStatementNames,
  AttendanceStatementRead,
  AttendanceStatementRequestRow,
  AttendanceStatementRow,
  StatementHeader,
  StatementInputs,
  StatementTotals,
} from './attendance-statement-data.ts';

/**
 * بيبني كشف الحضور الرسمي من مدخلاته المقروءة: بيرسم الصفوف والأرقام من غير أي قراءة تانية.
 * القواعد كلها في packages/domain، فالنتيجة بتطلع زي تقرير 27b بالظبط (FR-013).
 * حدّ القطع هو لحظة الطلب نفسها، فالدوام والورديات اللي ما خلصتش ما بتتحسبش (FR-013a).
 * مفيش تغطية = بيان فاضي؛ المصدر هو اللي بيفرّق بينه وبين الفشل (FR-013a).
 *
 * @param inputs طلب البيان وأسماؤه وصفوف 27b وصفوف الموظفات المجدول وجلساته المفتوحة
 * @returns البيان جاهز بأرقامه أو فاضي
 */
export function assembleAttendanceStatement(inputs: StatementInputs): AttendanceStatementRead {
  const { request, names, identity, reportRows, scheduledRows, openSessions } = inputs;
  const rows = mergeAttendanceStatementRows(reportRows, scheduledRows);
  const header = statementHeader(request, names, identity);
  if (request.form === 'EMPLOYEE') return employeeStatement(request, header, rows, openSessions);
  return branchStatement(request, header, rows);
}

// رأس البيان: اللغة والمنطقة والاسمان والفترة؛ الأسماء بلغة الطلب والإنجليزي ملجأ.
function statementHeader(
  request: AttendanceStatementRequestRow,
  names: AttendanceStatementNames,
  identity: StatementInputs['identity'],
): StatementHeader {
  return {
    language: request.language,
    timezone: names.timezone,
    businessName: statementIdentity(request.language, identity, names.business).header_name,
    branchName:
      request.language === 'ar'
        ? (names.branch.nameAr ?? names.branch.nameEn)
        : names.branch.nameEn,
    period: { from: request.period.from, to: request.period.to },
  };
}

// بيان الفرع: كل موظفة ليها تغطية، أو الموظفة المفلترة بس؛ والصفوف مرتبة برقم الموظفة.
function branchStatement(
  request: AttendanceStatementRequestRow,
  header: StatementHeader,
  rows: readonly AttendanceStatementRow[],
): AttendanceStatementRead {
  const period = request.period;
  const cutoff = request.requestedAt;
  const pair = request.shift;
  const chosen =
    request.employeeId === null
      ? rows
      : rows.filter((row) => row.employee_id === request.employeeId);
  const kept = chosen.filter((row) =>
    row.branches.some((branch) => hasAttendanceStatementCoverage(branch, period, cutoff, pair)),
  );
  if (kept.length === 0) return { kind: 'EMPTY' };
  const filtered =
    request.employeeId === null
      ? undefined
      : rows.find((row) => row.employee_id === request.employeeId);
  return {
    kind: 'READY',
    data: {
      businessId: request.businessId,
      requesterUserId: request.requesterUserId,
      logoFileId: request.logoFileId,
      statement: {
        ...header,
        form: 'BRANCH',
        employeeFilter:
          filtered === undefined
            ? null
            : {
                name: employeeName(filtered, request.language),
                employeeNumber: filtered.employee_number,
              },
        shiftFilter: pair === null ? null : { start: pair.start, end: pair.end },
        rows: kept.map((row) => ({
          employeeNumber: row.employee_number,
          name: employeeName(row, request.language),
          totals: statementTotals(row.branches, period, cutoff, pair),
        })),
      },
    },
  };
}

// بيان الموظفة: صف لكل يوم في الفترة وأرقامها؛ وزوج الشيفت ما بيتبطبش على النموذج ده.
function employeeStatement(
  request: AttendanceStatementRequestRow,
  header: StatementHeader,
  rows: readonly AttendanceStatementRow[],
  openSessions: StatementInputs['openSessions'],
): AttendanceStatementRead {
  const period = request.period;
  const cutoff = request.requestedAt;
  const row = rows.find((entry) => entry.employee_id === request.employeeId);
  const branch = row?.branches[0];
  if (row === undefined || branch === undefined) return { kind: 'EMPTY' };
  if (!hasAttendanceStatementCoverage(branch, period, cutoff, null)) return { kind: 'EMPTY' };
  return {
    kind: 'READY',
    data: {
      businessId: request.businessId,
      requesterUserId: request.requesterUserId,
      logoFileId: request.logoFileId,
      statement: {
        ...header,
        form: 'EMPLOYEE',
        employee: {
          name: employeeName(row, request.language),
          employeeNumber: row.employee_number,
        },
        totals: statementTotals(row.branches, period, cutoff, null),
        days: computeAttendanceStatementDays(
          branch,
          stillOpen(branch, openSessions),
          period,
          cutoff,
        ),
      },
    },
  };
}

/**
 * الجلسات المفتوحة اللي اتقفلت بين القراءتين: الجملة الأولى شافتها مفتوحة والتانية شافتها
 * مقفولة، فالمفتوحة دي بتتشال عشان اليوم ما يطبعش «لسه جوّه» والجلسة المقفولة بتتحسب
 * كأنها مقفولة (FR-011a). المقارنة بيوم العمل ولحظة الدخول (مش بنص النص) لأن صفوف 27b مالهاش
 * معرّف جلسة، والموظفة ليها جلسة مفتوحة واحدة على الأكثر (الفهرس الجزئي
 * attendance_sessions_one_open). جلسة مقفولة بنفس لحظة الدخول بالظبط ما نقدرش نفرّقها عن
 * المفتوحة، وده مقبول لأن اليوم ده بيطبع ساعات الجلسة المقفولة على أي حال؛ ومتتبع في issue #687
 * لحمل معرّف الجلسة في جملة المدخلات المشتركة.
 *
 * @param branch مدخلات الموظفة في الفرع
 * @param openSessions الجلسات المفتوحة كما قراها القارئ
 * @returns الجلسات المفتوحة اللي لسه مفتوحة فعلاً
 */
function stillOpen(
  branch: ReportBranchInputs,
  openSessions: readonly AttendanceOpenSession[],
): AttendanceOpenSession[] {
  return openSessions.filter(
    (open) =>
      !branch.sessions.some(
        (session) =>
          session.working_date === open.working_date &&
          Date.parse(session.clock_in) === Date.parse(open.clock_in),
      ),
  );
}

// أرقام الموظفة في الفترة؛ مع فلتر الشيفت بتطلع الساعات التعاقدية والفرق فاضيين (BR-11).
function statementTotals(
  branches: readonly ReportBranchInputs[],
  period: AttendancePeriod,
  cutoff: string,
  pair: AttendanceShiftPair | null,
): StatementTotals {
  const report =
    pair === null
      ? computeAttendancePeriodReport(branches, period, cutoff)
      : computeAttendanceShiftPeriodReport(branches, period, cutoff, pair);
  return {
    daysPresent: report.days_present,
    workedMinutes: report.worked_minutes,
    scheduledMinutes: report.scheduled_minutes,
    contractedMinutes: report.contracted_minutes,
    differenceMinutes: report.difference_minutes,
    leave: report.leave,
    lateCount: report.late_count,
    lateMinutes: report.late_minutes,
    missingClockOut: report.missing_clock_out,
    manualDays: report.manual_days,
  };
}

// اسم الموظفة بلغة الطلب: العربي لو موجود، والإنجليزي هو الملجأ.
function employeeName(row: AttendanceStatementRow, language: StatementLanguage): string {
  const arabic = row.name_ar;
  return language === 'ar' && arabic !== null && arabic.trim() !== '' ? arabic : row.name_en;
}
