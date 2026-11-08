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
import { historyIds, type HistoryScope } from './leave-history-days.sql.ts';
import { historyRows } from './leave-history-rows.sql.ts';
import { historyLastTaken } from './leave-history-last.sql.ts';

type Cursor = LeaveHistoryCursorData;
export function leaveHistorySql(
  c: LeaveReadContext,
  q: LeaveHistoryQuery,
  s: HistoryScope,
  options: { asOf: string; excludeOpen: boolean; cursor?: Cursor },
) {
  const { asOf, cursor } = options;
  const eligibilityDays = s.eligibilityDays ?? [];
  const eligibilityBranches = eligibilityDays.map((day) => day.branchId);
  // صفحة السجل وآخر إجازة في snapshot واحدة حتى لا تختلف النتائج بسبب كتابة متزامنة.
  // علامة الموظف من نفس snapshot تمنع تسريب آخر إجازة لو اتحذف بعد فحص الصلاحية.
  // وبنفس العلامة يتحقق ربط ساري: لو انتهى الارتباط بين الفحص والجملة الأخيرة فالصفحة لا تُفتح.
  return sql`${historyRows(c, q, s, options)}, subject AS (
    SELECT (EXISTS(SELECT 1 FROM employees
      WHERE company_id=${c.companyId} AND business_id=${c.businessId}
        AND id=${c.employeeId}::uuid AND deleted_at IS NULL)
      AND EXISTS(SELECT 1 FROM employee_branches eb
        WHERE eb.company_id=${c.companyId} AND eb.business_id=${c.businessId}
          AND eb.employee_id=${c.employeeId}::uuid
          AND eb.branch_id=ANY(${historyIds(eligibilityBranches)})
          AND ${currentAttachment(eligibilityDays)})) AS exists
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
    CASE WHEN subject.exists THEN ${historyLastTaken(c, s, asOf)} END AS last_taken
    FROM subject`;
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
  const [result] = await tx.execute<{
    rows: (Cursor & { record: LeaveHistoryPage['items'][number] })[];
    subject_exists: boolean;
    last_taken: LeaveHistoryPage['last_taken'];
  }>(leaveHistorySql(c, q, scope, { asOf, excludeOpen: true, ...(cursor ? { cursor } : {}) }));
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
