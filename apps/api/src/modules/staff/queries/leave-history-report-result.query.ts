import type { TenantWrappers, Tx } from '@pospay/db';
import {
  leaveHistoryReportCursorData,
  leaveHistoryReportStoredScope,
  type LeaveHistoryReportFailureCode,
  type LeaveHistoryReportResultQuery,
  type LeaveHistoryReportStatus,
} from '@pospay/contracts';
import { errorMessages } from '@pospay/i18n';
import { sql } from 'drizzle-orm';
import { decodeCursor } from '../../../shared/persistence/name-options-cursor.ts';
import type { LeaveReadAccess, LeaveReadContext } from './leave-requests.query.ts';
import { readLeaveHistoryReportPage } from './leave-history-report-page.sql.ts';
import { leaveHistoryReportScopeIsStale } from './leave-history-report-stale.ts';

type ReportRow = {
  readonly status: 'pending' | 'ready' | 'failed';
  readonly scope: unknown;
  readonly as_of: Date;
  readonly before_deadline: boolean;
  readonly error_code: LeaveHistoryReportFailureCode | null;
  readonly row_count: number;
  readonly computed_at: Date | null;
};

type ResultRead = {
  readonly context: LeaveReadContext;
  readonly reportId: string;
  readonly query: LeaveHistoryReportResultQuery;
};

// سائق postgres-js بيرجّع عمود scope من نوع jsonb كنص خام، فنحلّ النص قبل تحقق zod.
function storedScopeValue(value: unknown): unknown {
  return typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
}

function leaveHistoryReportLookupStatement(context: LeaveReadContext, reportId: string) {
  // شاشة تقرير سجل الإجازات (68-4) تجد تقرير صاحب الطلب غير المنتهي قبل أي فحص صلاحية آخر.
  return sql`SELECT status,scope,as_of,error_code,row_count,computed_at,
    clock_timestamp()<deadline_at AS before_deadline
    FROM leave_history_reports
    WHERE company_id=${context.companyId} AND business_id=${context.businessId}
      AND created_by=${context.userId} AND id=${reportId} AND expires_at>now()`;
}

function cursorAfter(encoded: string | undefined, reportId: string): number | 'VALIDATION_FAILED' {
  if (encoded === undefined) return 0;
  try {
    const cursor = decodeCursor(encoded, (value) => leaveHistoryReportCursorData.parse(value));
    const sameReport = cursor.report_id.toLowerCase() === reportId.toLowerCase();
    return sameReport ? cursor.seq : 'VALIDATION_FAILED';
  } catch {
    return 'VALIDATION_FAILED';
  }
}

function failedLeaveHistoryReport(
  code: LeaveHistoryReportFailureCode | null,
): LeaveHistoryReportStatus {
  if (code === null) throw new Error('LEAVE_HISTORY_REPORT_FAILURE_MISSING');
  return {
    status: 'failed',
    error: { code, ...errorMessages(code) },
  } satisfies LeaveHistoryReportStatus;
}

async function pendingLeaveHistoryReport(
  tx: Tx,
  context: LeaveReadContext,
  reportId: string,
  beforeDeadline: boolean,
): Promise<LeaveHistoryReportStatus> {
  if (beforeDeadline) return { status: 'pending' } satisfies LeaveHistoryReportStatus;
  // شاشة تقرير سجل الإجازات (68-4) لا تنتظر بناءً يمسك التقرير عند انتهاء مهلته.
  const [row] = await tx.execute<{ found: boolean }>(sql`SELECT true AS found
    FROM leave_history_reports
    WHERE company_id=${context.companyId} AND id=${reportId} AND status='pending'
    FOR SHARE SKIP LOCKED`);
  if (row === undefined) return { status: 'pending' } satisfies LeaveHistoryReportStatus;
  return failedLeaveHistoryReport('LEAVE_HISTORY_REPORT_FAILED');
}

async function readLeaveHistoryReportResult(tx: Tx, input: ResultRead, access: LeaveReadAccess) {
  const { context, reportId, query } = input;
  const [report] = await tx.execute<ReportRow>(
    leaveHistoryReportLookupStatement(context, reportId),
  );
  if (report === undefined) return 'LEAVE_HISTORY_REPORT_NOT_FOUND' as const;
  const scope = await access.check(tx, { ...context, own: false });
  if (scope === null || scope.branches.length === 0) return null;
  if (!scope.featureEnabled) return 'FEATURE_DISABLED' as const;
  const frozen = leaveHistoryReportStoredScope.parse(storedScopeValue(report.scope));
  const currentScope = {
    branches: scope.branches,
    attendanceBranches: scope.attendanceBranches,
    eligibilityBranchIds: (scope.eligibilityDays ?? []).map((day) => day.branchId),
  };
  if (leaveHistoryReportScopeIsStale(frozen, currentScope)) {
    return 'LEAVE_HISTORY_REPORT_STALE' as const;
  }
  const after = cursorAfter(query.cursor, reportId);
  if (after === 'VALIDATION_FAILED') return after;
  if (report.status === 'pending') {
    return pendingLeaveHistoryReport(tx, context, reportId, report.before_deadline);
  }
  if (report.status === 'failed') return failedLeaveHistoryReport(report.error_code);
  return readLeaveHistoryReportPage(tx, context, scope, {
    frozen,
    report,
    reportId,
    query,
    after,
  });
}

export const LEAVE_HISTORY_REPORT_RESULT_READER = Symbol('LEAVE_HISTORY_REPORT_RESULT_READER');
export class LeaveHistoryReportResultReader {
  constructor(
    private readonly db: TenantWrappers | null,
    private readonly access: LeaveReadAccess,
  ) {}

  async execute(
    context: LeaveReadContext,
    reportId: string,
    query: LeaveHistoryReportResultQuery,
  ) {
    if (this.db === null) return 'NOT_READY' as const;
    return this.db.withTenant(
      context.companyId,
      (tx) => readLeaveHistoryReportResult(tx, { context, reportId, query }, this.access),
      { userId: context.userId },
    );
  }
}
