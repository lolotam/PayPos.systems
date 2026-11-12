import {
  leaveHistorySql,
  type HistoryScope,
  type LeaveHistoryReportOptions,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import {
  leaveHistoryCursorData,
  type LeaveHistoryCursorData,
  type LeaveHistoryPage,
  type LeaveHistoryQuery,
} from '@pospay/contracts';
import { decodeCursor, encodeCursor } from '../../../shared/persistence/name-options-cursor.ts';
import type { LeaveReadAccess, LeaveReadContext } from './leave-requests.query.ts';
import { historyLeaveWorkloadSql, historyWorkloadSql } from './leave-history-workload.sql.ts';

type Cursor = LeaveHistoryCursorData;
type HistoryWorkload = { shifts?: number; leaves: number };

async function historyWorkloadExceeded(
  tx: Tx,
  c: LeaveReadContext,
  q: LeaveHistoryQuery,
  scope: HistoryScope,
  options: {
    asOf: string;
    workload: HistoryWorkload;
    report?: LeaveHistoryReportOptions | undefined;
  },
) {
  const { asOf, workload, report } = options;
  if (workload.shifts !== undefined) {
    const [shiftRows] = await tx.execute<{ shifts: number }>(
      historyWorkloadSql(c, scope, q, workload.shifts),
    );
    if (shiftRows !== undefined && shiftRows.shifts > workload.shifts) return true;
  }
  const [leaveRows] = await tx.execute<{ leaves: number }>(
    historyLeaveWorkloadSql(
      c,
      q,
      scope,
      { asOf, ...(report ? { visibility: report.attachment } : {}) },
      workload.leaves,
    ),
  );
  return leaveRows !== undefined && leaveRows.leaves > workload.leaves;
}

export async function readLeaveHistoryPage(
  tx: Tx,
  c: LeaveReadContext,
  q: LeaveHistoryQuery,
  scope: HistoryScope,
  options: { excludeOpen: boolean; report?: LeaveHistoryReportOptions; workload?: HistoryWorkload },
) {
  let cursor: Cursor | undefined;
  try {
    cursor =
      q.cursor === undefined
        ? undefined
        : decodeCursor(q.cursor, (v) => leaveHistoryCursorData.parse(v));
  } catch {
    return 'VALIDATION_FAILED' as const;
  }
  const asOf = cursor?.as_of ?? scope.now.toISOString();
  const instant = Date.parse(asOf);
  if (instant > scope.now.getTime() || instant < scope.now.getTime() - 86_400_000)
    return 'VALIDATION_FAILED' as const;
  if (q.branch_id !== undefined && !scope.branches.includes(q.branch_id)) return null;
  if (
    options.workload !== undefined &&
    (await historyWorkloadExceeded(tx, c, q, scope, {
      asOf,
      workload: options.workload,
      report: options.report,
    }))
  )
    return 'LEAVE_HISTORY_REPORT_REQUIRED' as const;
  const [result] = await tx.execute<{
    rows: (Cursor & { record: LeaveHistoryPage['items'][number] })[];
    subject_exists: boolean;
    last_taken: LeaveHistoryPage['last_taken'];
  }>(
    leaveHistorySql(c, q, scope, {
      asOf,
      excludeOpen: options.excludeOpen,
      ...(cursor ? { cursor } : {}),
      ...(options.report ? { report: options.report } : {}),
    }),
  );
  if (!result) throw new Error('LEAVE_HISTORY_SNAPSHOT_MISSING');
  if (!result.subject_exists) return null;
  const rows = result.rows;
  const selected = rows.slice(0, q.limit);
  const last = selected.at(-1);
  return {
    items: selected.map((r) => r.record),
    as_of: asOf,
    next_cursor:
      rows.length > q.limit && last
        ? encodeCursor({ date: last.date, rank: last.rank, id: last.id, as_of: asOf })
        : null,
    last_taken: result.last_taken,
    request_branch_ids: scope.createBranches,
    absence_branch_ids: scope.attendanceBranches,
  } satisfies LeaveHistoryPage;
}

export async function getEmployeeLeaveHistory(
  tx: Tx,
  c: LeaveReadContext,
  q: LeaveHistoryQuery,
  access: LeaveReadAccess,
) {
  const scope = await access.check(tx, { ...c, purpose: 'history' });
  if (!scope || scope.branches.length === 0) return null;
  if (!scope.featureEnabled) return 'FEATURE_DISABLED' as const;
  // بيانات الأهلية داخلية؛ غيابها يمنع السجل بدل نطاق فارغ يمنح وصولاً.
  if (!scope.eligibilityDays?.length) return null;
  return readLeaveHistoryPage(tx, c, q, scope, { excludeOpen: true });
}

export const LEAVE_HISTORY_READER = Symbol('LEAVE_HISTORY_READER');
export class LeaveHistoryReader {
  constructor(
    private readonly db: TenantWrappers | null,
    private readonly access: LeaveReadAccess,
  ) {}
  async execute(context: LeaveReadContext, query: LeaveHistoryQuery) {
    if (this.db === null) return 'NOT_READY' as const;
    return this.db.withTenant(
      context.companyId,
      (tx) => getEmployeeLeaveHistory(tx, context, query, this.access),
      { userId: context.userId },
    );
  }
}
