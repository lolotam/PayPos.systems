import { sql } from 'drizzle-orm';
import { currentAttachment, type TenantWrappers, type Tx } from '@pospay/db';
import {
  leaveHistoryCursorData,
  type LeaveHistoryCursorData,
  type LeaveHistoryPage,
  type LeaveHistoryQuery,
} from '@pospay/contracts';
import { decodeCursor, encodeCursor } from '../../../shared/persistence/name-options-cursor.ts';
import type { LeaveReadAccess, LeaveReadContext } from './leave-requests.query.ts';
import { historyEmployeeVisible, historyIds, type HistoryScope } from './leave-history-days.sql.ts';
import { historyRows } from './leave-history-rows.sql.ts';
import { historyLastTaken } from './leave-history-last.sql.ts';
import { historyWorkloadSql } from './leave-history-workload.sql.ts';

type Cursor = LeaveHistoryCursorData;
type HistoryReport = { attachment: 'current' | 'any' };

function historySubject(c: LeaveReadContext, s: HistoryScope, report?: HistoryReport) {
  if (report !== undefined) {
    if (c.employeeId === undefined) return sql`SELECT TRUE AS exists`;
    return sql`SELECT (EXISTS(SELECT 1 FROM employees subject
      WHERE company_id=${c.companyId} AND business_id=${c.businessId}
        AND id=${c.employeeId}::uuid AND deleted_at IS NULL
        AND ${historyEmployeeVisible(c, s, 'subject', report.attachment)})) AS exists`;
  }
  const eligibilityDays = s.eligibilityDays ?? [];
  const eligibilityBranches = eligibilityDays.map((day) => day.branchId);
  return sql`SELECT (EXISTS(SELECT 1 FROM employees
      WHERE company_id=${c.companyId} AND business_id=${c.businessId}
        AND id=${c.employeeId}::uuid AND deleted_at IS NULL)
      AND EXISTS(SELECT 1 FROM employee_branches eb
        WHERE eb.company_id=${c.companyId} AND eb.business_id=${c.businessId}
          AND eb.employee_id=${c.employeeId}::uuid
          AND eb.branch_id=ANY(${historyIds(eligibilityBranches)})
          AND ${currentAttachment(eligibilityDays)})) AS exists`;
}

export function leaveHistorySql(
  c: LeaveReadContext,
  q: LeaveHistoryQuery,
  s: HistoryScope,
  options: { asOf: string; excludeOpen: boolean; cursor?: Cursor; report?: HistoryReport },
) {
  const { asOf, cursor, report } = options;
  const rows = historyRows(c, q, s, {
    ...options,
    ...(report === undefined ? {} : { visibility: report.attachment }),
  });
  const lastTaken =
    c.employeeId === undefined
      ? sql`NULL`
      : sql`CASE WHEN subject.exists THEN ${historyLastTaken(c, s, asOf)} END`;
  // صفحة السجل وآخر إجازة في snapshot واحدة حتى لا تختلف النتائج بسبب كتابة متزامنة.
  // علامة الموظف من نفس snapshot تمنع تسريب آخر إجازة لو اتحذف بعد فحص الصلاحية.
  // تبويب الملف يعيد فحص الربط الساري؛ التقرير يعيد فحص الوجود ورؤية الموظف المختارة.
  return sql`${rows}, subject AS (
    ${historySubject(c, s, report)}
  ), page AS (
    SELECT * FROM rows ${
      cursor === undefined
        ? sql``
        : sql`WHERE date<${cursor.date}::date
      OR (date=${cursor.date}::date AND rank>${cursor.rank})
      OR (date=${cursor.date}::date AND rank=${cursor.rank} AND id<${cursor.id}::uuid)`
    }
    ORDER BY date DESC,rank,id DESC LIMIT ${q.limit + 1}
  ) SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('date',date,'rank',rank,'id',id,'record',record)
    ORDER BY date DESC,rank,id DESC) FROM page),'[]'::jsonb) AS rows,
    subject.exists AS subject_exists,
    ${lastTaken} AS last_taken
    FROM subject`;
}

export async function readLeaveHistoryPage(
  tx: Tx,
  c: LeaveReadContext,
  q: LeaveHistoryQuery,
  scope: HistoryScope,
  options: { excludeOpen: boolean; report?: HistoryReport; workloadLimit?: number },
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
  if (options.workloadLimit !== undefined) {
    const [workload] = await tx.execute<{ shifts: number }>(
      historyWorkloadSql(c, scope, q, options.workloadLimit),
    );
    if (workload !== undefined && workload.shifts > options.workloadLimit)
      return 'LEAVE_HISTORY_REPORT_REQUIRED' as const;
  }
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
