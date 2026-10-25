import {
  attendanceStatementStatus,
  type AttendanceStatementStatus,
  type DocumentRenderErrorCode,
  type DocumentRenderState,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { ApiError } from '../../../shared/errors.ts';

export const DOCUMENT_STATUS_READ = Symbol('DOCUMENT_STATUS_READ');

/** نطاق الطلب: الشركة والمستخدم والنشاط والفرع من المسار. */
export interface AttendanceStatementScope {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
}

/** صف الطلب كما يقرؤه الاستعلام؛ الأعمدة دي هي اللي بيحتاجها التحميل كمان. */
export interface AttendanceStatementRequestRow extends Record<string, unknown> {
  form: string;
  employee_id: string | null;
  period_from: string;
  period_to: string;
  language: string;
  shift_start: string | null;
  shift_end: string | null;
  business_id: string;
  branch_id: string;
}

/** منفذ قراءة حالة المستند بجوار الاستعلام، عشان مسار القراءة ما يعتمدش على ports/. */
export interface DocumentStatusRead {
  /** يقرأ حالة المستند من Redis؛ null لما الهاش معدش موجود أو حالته مش معروفة. */
  read(
    companyId: string,
    renderId: string,
  ): Promise<{
    state: DocumentRenderState;
    requestedBy: string;
    errorCode: DocumentRenderErrorCode | null;
    bytesPresent: boolean;
    mimeType: string | null;
  } | null>;
}

/**
 * جملة صف الطلب المربوط بالمسار والمستخدم؛ نفس الجملة بتخدم التحميل بعدين.
 */
export function attendanceStatementRequestStatement(
  companyId: string,
  businessId: string,
  branchId: string,
  renderId: string,
  userId: string,
) {
  return sql`SELECT form, employee_id, period_from::text AS period_from, period_to::text AS period_to,
      language, shift_start, shift_end, business_id, branch_id
    FROM attendance_statement_requests
    WHERE company_id = ${companyId} AND company_id = app_company_id() AND id = ${renderId}::uuid
      AND business_id = ${businessId} AND branch_id = ${branchId} AND requested_by = ${userId}`;
}

/**
 * حالة البيان: صف الطلب في المستأجر، وبعدين هاش الحالة في Redis.
 * الطلب والـ Redis اتنين بيلزموا نفس المستخدم؛ أي غلط فيهم زي الـ 404 نفسه (ADR-0049 §1.5).
 */
export async function readAttendanceStatementStatus(
  database: Pick<TenantWrappers, 'withTenant'>,
  status: DocumentStatusRead,
  scope: AttendanceStatementScope,
  renderId: string,
): Promise<AttendanceStatementStatus> {
  const row = await database.withTenant(
    scope.companyId,
    async (tx) => {
      const rows = await tx.execute<AttendanceStatementRequestRow>(
        attendanceStatementRequestStatement(
          scope.companyId,
          scope.businessId,
          scope.branchId,
          renderId,
          scope.userId,
        ),
      );
      return rows[0] ?? null;
    },
    { userId: scope.userId },
  );
  if (row === null) throw new ApiError('NOT_FOUND');
  const hash = await status.read(scope.companyId, renderId);
  if (hash === null) throw new ApiError('NOT_FOUND');
  if (hash.requestedBy !== scope.userId) throw new ApiError('NOT_FOUND');
  // البايتات اللي راحت قبل ما ينزلها المستخدم بتقرأ منتهية، مش مفقودة (ADR-0049 §1.6).
  const state = hash.state === 'READY' && !hash.bytesPresent ? 'EXPIRED' : hash.state;
  return attendanceStatementStatus.parse({
    state,
    ...(state === 'FAILED' && hash.errorCode !== null ? { error_code: hash.errorCode } : {}),
  });
}
