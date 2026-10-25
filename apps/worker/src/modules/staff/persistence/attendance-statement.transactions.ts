import {
  attendanceMonthlyInputsStatement,
  attendanceStatementScheduledEmployeesStatement,
  type AttendanceReportScope,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import type { AttendanceReportBranchInputs } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type {
  AttendanceStatementNames,
  AttendanceStatementRequestRow,
} from '../domain/attendance-statement-data.ts';
import type {
  StatementIdentityReader,
  StatementInputsReader,
  StatementOpenSessionsReader,
} from '../ports/attendance-statement.port.ts';

/** صف الموظفة كما يقرؤه تقرير 27b أو جملة الموظفات المجدول بس. */
interface StatementInputRow extends Record<string, unknown> {
  employee_id: string;
  name_ar: string | null;
  name_en: string;
  employee_number: number;
  branches: AttendanceReportBranchInputs[];
}

type RequestRow = {
  business_id: string;
  branch_id: string;
  form: string;
  employee_id: string | null;
  period_from: string;
  period_to: string;
  language: string;
  shift_start: string | null;
  shift_end: string | null;
  logo_file_id: string | null;
  requested_by: string;
  requested_at: Date | string;
};

type PlacesRow = {
  branch_name_ar: string | null;
  branch_name_en: string;
  branch_timezone: string | null;
  business_name_ar: string | null;
  business_name_en: string;
  business_timezone: string;
};

/**
 * مدخلات البيان من جدول الطلبات: معلماته ولحظة طلبه؛ مفيش أي رقم محسوب هنا.
 */
export function attendanceStatementRequestStatement(companyId: string, renderId: string) {
  return sql`SELECT business_id, branch_id, form, employee_id,
      period_from::text AS period_from, period_to::text AS period_to,
      language, shift_start, shift_end, logo_file_id, requested_by, requested_at
    FROM attendance_statement_requests
    WHERE company_id = ${companyId} AND company_id = app_company_id() AND id = ${renderId}::uuid`;
}

/**
 * أسماء الفرع والنشاط ومنطقتيهما في جملة واحدة؛ منطقة الفرع وإلا منطقة النشاط (PRD D-10).
 * الجدولان ملك التينانسي، بس الـ worker مافيشش describeWorkspaces زي الـ API، والصف لازم يتقرا
 * في نفس معاملة الطلب؛ فالجملة هنا بتقرا الجدولين بعينهم من غير استيراد لوحدة تانية.
 */
export function attendanceStatementPlacesStatement(
  companyId: string,
  businessId: string,
  branchId: string,
) {
  return sql`SELECT b.name_ar AS branch_name_ar, b.name_en AS branch_name_en, b.timezone AS branch_timezone,
      bu.name_ar AS business_name_ar, bu.name_en AS business_name_en, bu.timezone AS business_timezone
    FROM branches b JOIN businesses bu ON bu.company_id = b.company_id AND bu.id = b.business_id
    WHERE b.company_id = ${companyId} AND b.company_id = app_company_id()
      AND b.business_id = ${businessId}::uuid AND b.id = ${branchId}::uuid`;
}

/**
 * قارئ مدخلات البيان: معاملة قراءة واحدة بالترتيب ده، وبعدها بتتقفل قبل أي حساب.
 * الطلب بيتقرا الأول عشان معلماته هي اللي بتحدد الفرع والفترة، والبقية بتتبني عليها.
 */
export function attendanceStatementTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  identity: StatementIdentityReader<Tx>,
  openSessions: StatementOpenSessionsReader<Tx>,
): StatementInputsReader {
  return {
    read: (companyId, renderId, signal) => {
      // الرندر الملغى ما يفتحش معاملة؛ طبقة الـ documents بتحوّل الإلغاء لخطأ المهلة.
      signal?.throwIfAborted();
      return database.withTenant(companyId, async (tx) => {
        const request = await readRequest(tx, companyId, renderId);
        if (request === null) return null;
        const names = await readNames(tx, companyId, request);
        const period = { from: request.period.from, to: request.period.to };
        const branch = { id: request.branchId, timezone: names.timezone };
        const scope: AttendanceReportScope = { businessId: request.businessId, branches: [branch] };
        const reportRows = await tx.execute<StatementInputRow>(
          attendanceMonthlyInputsStatement(companyId, scope, period.from, period.to),
        );
        const scheduledRows = await tx.execute<StatementInputRow>(
          attendanceStatementScheduledEmployeesStatement(
            companyId,
            request.businessId,
            branch,
            period.from,
            period.to,
          ),
        );
        return {
          request,
          names,
          identity: await identity.read(tx, companyId, request.businessId),
          reportRows,
          scheduledRows,
          openSessions: await readOpenSessions(openSessions, tx, companyId, request),
        };
      });
    },
  };
}

async function readRequest(
  tx: Tx,
  companyId: string,
  renderId: string,
): Promise<AttendanceStatementRequestRow | null> {
  const rows = await tx.execute<RequestRow>(
    attendanceStatementRequestStatement(companyId, renderId),
  );
  const row = rows[0];
  if (row === undefined) return null;
  const shift =
    row.shift_start === null || row.shift_end === null
      ? null
      : { start: row.shift_start.slice(0, 5), end: row.shift_end.slice(0, 5) };
  return {
    businessId: row.business_id,
    branchId: row.branch_id,
    form: row.form === 'EMPLOYEE' ? 'EMPLOYEE' : 'BRANCH',
    employeeId: row.employee_id,
    period: { from: row.period_from, to: row.period_to },
    language: row.language === 'en' ? 'en' : 'ar',
    shift,
    logoFileId: row.logo_file_id,
    requesterUserId: row.requested_by,
    requestedAt: new Date(row.requested_at).toISOString(),
  };
}

async function readNames(
  tx: Tx,
  companyId: string,
  request: AttendanceStatementRequestRow,
): Promise<AttendanceStatementNames> {
  const rows = await tx.execute<PlacesRow>(
    attendanceStatementPlacesStatement(companyId, request.businessId, request.branchId),
  );
  const row = rows[0];
  // الفرع لازم يكون موجود: مفتاح الطلب المركّب بيمنع غيره، فالغياب يعني صف مكسور.
  if (row === undefined) throw new Error('ATTENDANCE_STATEMENT_BRANCH_MISSING');
  return {
    business: { name_ar: row.business_name_ar, name_en: row.business_name_en },
    branch: { nameAr: row.branch_name_ar, nameEn: row.branch_name_en },
    timezone: row.branch_timezone ?? row.business_timezone,
  };
}

async function readOpenSessions(
  openSessions: StatementOpenSessionsReader<Tx>,
  tx: Tx,
  companyId: string,
  request: AttendanceStatementRequestRow,
) {
  // الجلسات المفتوحة لبيان الموظفة بس؛ نموذج الفرع ما بيعرضش يوم بيوم (FR-011a).
  if (request.form !== 'EMPLOYEE' || request.employeeId === null) return [];
  return openSessions(
    tx,
    companyId,
    request.branchId,
    request.employeeId,
    request.period.from,
    request.period.to,
  );
}
