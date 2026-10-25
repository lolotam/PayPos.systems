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
import type { BranchPlaceReader } from '../ports/branch-place.port.ts';
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

/**
 * مهلة جملة واحدة داخل معاملة البيان: رندر ملغى أو تالف لازم يسيب اتصاله من الـ pool
 * بدل ما يقعد عليه. أقل من مهلة الـ worker كلها (30 ثانية في process-job.ts).
 */
export const STATEMENT_READ_TIMEOUT_MS = 20_000;

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
 * قارئ مدخلات البيان: معاملة قراءة واحدة بالترتيب ده، وبعدها بتتقفل قبل أي حساب.
 * الطلب بيتقرا الأول عشان معلماته هي اللي بتحدد الفرع والفترة، والبقية بتتبني عليها.
 * الجلسات المفتوحة بتتقرا قبل جملة 27b: جلسة بتتقفل بين القراءتين بتكون في التانية
 * مش في الأولى، فالترتيب ده بيمنع ضياعها (FR-011a).
 */
export function attendanceStatementTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  identity: StatementIdentityReader<Tx>,
  branchPlace: BranchPlaceReader<Tx>,
  openSessions: StatementOpenSessionsReader<Tx>,
): StatementInputsReader {
  return {
    read: (companyId, renderId, signal) => {
      // الرندر الملغى ما يفتحش معاملة؛ طبقة الـ documents بتحوّل الإلغاء لخطأ المهلة.
      signal?.throwIfAborted();
      return database.withTenant(companyId, async (tx) => {
        // أول جملة في المعاملة: مهلة لكل جملة بعدها، عشان الرندر الملغى يسيب الاتصال.
        await tx.execute(`SET LOCAL statement_timeout = '${STATEMENT_READ_TIMEOUT_MS}ms'`);
        // الإلغاء بيتفحص قبل كل قراءة: رندر ملغى بيقف عند أقرب جملة، والمعاملة بتتقفل.
        signal?.throwIfAborted();
        const request = await readRequest(tx, companyId, renderId);
        if (request === null) return null;
        signal?.throwIfAborted();
        const open = await readOpenSessions(openSessions, tx, companyId, request);
        signal?.throwIfAborted();
        const names = await readNames(tx, companyId, request, branchPlace);
        signal?.throwIfAborted();
        const period = { from: request.period.from, to: request.period.to };
        const branch = { id: request.branchId, timezone: names.timezone };
        const scope: AttendanceReportScope = { businessId: request.businessId, branches: [branch] };
        const reportRows = await tx.execute<StatementInputRow>(
          attendanceMonthlyInputsStatement(companyId, scope, period.from, period.to),
        );
        signal?.throwIfAborted();
        const scheduledRows = await tx.execute<StatementInputRow>(
          attendanceStatementScheduledEmployeesStatement(
            companyId,
            request.businessId,
            branch,
            period.from,
            period.to,
          ),
        );
        signal?.throwIfAborted();
        const stored = await identity.read(tx, companyId, request.businessId);
        signal?.throwIfAborted();
        return {
          request,
          names,
          identity: stored,
          reportRows,
          scheduledRows,
          openSessions: open,
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

/**
 * أسماء الفرع والنشاط ومنطقته الفعّالة؛ الجدولان ملك التينانسي، فبينتقرا من بوابة
 * BranchPlaceReader على معاملة الطلب نفسها (ADR-0056 §2).
 */
async function readNames(
  tx: Tx,
  companyId: string,
  request: AttendanceStatementRequestRow,
  branchPlace: BranchPlaceReader<Tx>,
): Promise<AttendanceStatementNames> {
  const place = await branchPlace.forBranch(tx, companyId, request.businessId, request.branchId);
  // الفرع لازم يكون موجود: مفتاح الطلب المركّب بيمنع غيره، فالغياب يعني صف مكسور.
  if (place === null) throw new Error('ATTENDANCE_STATEMENT_BRANCH_MISSING');
  return {
    business: { name_ar: place.businessNameAr, name_en: place.businessNameEn },
    branch: { nameAr: place.nameAr, nameEn: place.nameEn },
    timezone: place.timeZone,
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
