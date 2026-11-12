import {
  historyEmployeeVisible,
  type HistoryScope,
  type LeaveHistoryContext,
  type Tx,
} from '@pospay/db';
import type {
  LeaveHistoryItem,
  LeaveHistoryReportResultQuery,
  LeaveHistoryReportStatus,
  LeaveHistoryReportStoredScope,
} from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { encodeCursor } from '../../../shared/persistence/name-options-cursor.ts';

// نافذة الألف تحد فحص الصفوف المخفية دون لفّ استعلامات لملء الصفحة.
export const LEAVE_HISTORY_REPORT_PAGE_WINDOW = 1_000;

type ReadyReport = {
  readonly row_count: number;
  readonly as_of: Date;
  readonly computed_at: Date | null;
};

type PageRead = {
  readonly frozen: LeaveHistoryReportStoredScope;
  readonly report: ReadyReport;
  readonly reportId: string;
  readonly query: LeaveHistoryReportResultQuery;
  readonly after: number;
};

export function leaveHistoryReportPageStatement(
  context: LeaveHistoryContext,
  scope: HistoryScope,
  page: { reportId: string; after: number; limit: number },
) {
  // شاشة تقرير سجل الإجازات (68-4) تقرأ صفحة واحدة مع إعادة تطبيق رؤية الموظف الحالية.
  return sql`SELECT r.seq,r.record FROM leave_history_report_rows r
    JOIN employees e ON e.company_id=r.company_id AND e.business_id=${context.businessId}
      AND e.id=r.employee_id AND e.deleted_at IS NULL
    WHERE r.company_id=${context.companyId} AND r.report_id=${page.reportId}
      AND r.seq>${page.after} AND r.seq<=${page.after + LEAVE_HISTORY_REPORT_PAGE_WINDOW}
      AND ${historyEmployeeVisible(context, scope, 'e', 'current')}
    ORDER BY r.seq LIMIT ${page.limit + 1}`;
}

/** يحدد مؤشر النافذة التالية حتى لو كانت كل صفوفها مخفية عن القارئ. */
export function nextPageCursorSeq(
  visibleSeqs: readonly number[],
  after: number,
  limit: number,
  rowCount: number,
): number | null {
  if (visibleSeqs.length > limit) return visibleSeqs.at(limit - 1) ?? null;
  if (after + LEAVE_HISTORY_REPORT_PAGE_WINDOW < rowCount) {
    return after + LEAVE_HISTORY_REPORT_PAGE_WINDOW;
  }
  return null;
}

export async function readLeaveHistoryReportPage(
  tx: Tx,
  context: LeaveHistoryContext,
  scope: HistoryScope,
  input: PageRead,
): Promise<LeaveHistoryReportStatus> {
  const { frozen, report, reportId, query, after } = input;
  if (report.computed_at === null) throw new Error('LEAVE_HISTORY_REPORT_COMPLETION_MISSING');
  const rows = await tx.execute<{ seq: number; record: LeaveHistoryItem }>(
    leaveHistoryReportPageStatement(context, scope, {
      reportId,
      after,
      limit: query.limit,
    }),
  );
  const nextSeq = nextPageCursorSeq(
    rows.map((row) => row.seq),
    after,
    query.limit,
    report.row_count,
  );
  return {
    status: 'ready',
    items: rows.slice(0, query.limit).map((row) => row.record),
    next_cursor: nextSeq === null ? null : encodeCursor({ report_id: reportId, seq: nextSeq }),
    as_of: new Date(report.as_of).toISOString(),
    computed_at: new Date(report.computed_at).toISOString(),
    last_taken: null,
    request_branch_ids: scope.createBranches,
    absence_branch_ids: frozen.attendanceBranches,
  } satisfies LeaveHistoryReportStatus;
}
