import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { Tx } from '@pospay/db';
import type { LeaveHistoryPage, LeaveHistoryQuery } from '@pospay/contracts';
import { decodeCursor, encodeCursor } from '../../../shared/persistence/name-options-cursor.ts';
import type { LeaveReadAccess, LeaveReadContext } from './leave-requests.query.ts';
import type { HistoryScope } from './leave-history-days.sql.ts';
import { historyRows } from './leave-history-rows.sql.ts';
import { historyLastTaken } from './leave-history-last.sql.ts';

const cursorSchema = z.strictObject({
  date: z.iso.date(),
  rank: z.number().int().min(1).max(3),
  id: z.uuid(),
  as_of: z.iso.datetime(),
});
type Cursor = z.infer<typeof cursorSchema>;
export function leaveHistorySql(
  c: LeaveReadContext,
  q: LeaveHistoryQuery,
  s: HistoryScope,
  options: { asOf: string; excludeOpen: boolean; cursor?: Cursor },
) {
  const { asOf, cursor } = options;
  // صفحة السجل وآخر إجازة في snapshot واحدة حتى لا تختلف النتائج بسبب كتابة متزامنة.
  return sql`${historyRows(c, q, s, options)}, page AS (
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
    ${historyLastTaken(c, s, asOf)} AS last_taken`;
}
export async function getEmployeeLeaveHistory(
  tx: Tx,
  c: LeaveReadContext,
  q: LeaveHistoryQuery,
  access: LeaveReadAccess,
) {
  const scope = await access.check(tx, c);
  if (!scope || scope.branches.length === 0) return null;
  if (!scope.featureEnabled) return 'FEATURE_DISABLED' as const;
  let cursor: Cursor | undefined;
  try {
    cursor =
      q.cursor === undefined ? undefined : decodeCursor(q.cursor, (v) => cursorSchema.parse(v));
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
    last_taken: LeaveHistoryPage['last_taken'];
  }>(leaveHistorySql(c, q, scope, { asOf, excludeOpen: true, ...(cursor ? { cursor } : {}) }));
  if (!result) throw new Error('LEAVE_HISTORY_SNAPSHOT_MISSING');
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
