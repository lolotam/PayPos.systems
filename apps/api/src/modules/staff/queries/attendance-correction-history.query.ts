import {
  attendanceCorrectionHistory as view,
  type AttendanceCorrectionHistory,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { attendanceActorNameStatement } from './attendance-actor-name.query.ts';
import type { AttendanceBoardScope } from './attendance-board.query.ts';

const instant = (column: string) =>
  sql`to_char(${sql.raw(column)} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export function attendanceCorrectionHistoryStatement(
  scope: AttendanceBoardScope,
  sessionId: string,
) {
  // شاشة سجل التصحيح تُبقي التاريخ مقروءاً بعد الإلغاء وتفرّق بين جلسة مفقودة وجلسة بلا تصحيحات.
  return sql`SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'field',c.field,
      'before_at',${instant('c.before_at')},'after_at',${instant('c.after_at')},'reason',c.reason,
      'corrected_by',jsonb_build_object('id',c.corrected_by,
        'name',${attendanceActorNameStatement(sql`c.company_id`, sql`c.corrected_by`)}),
      'corrected_at',${instant('c.corrected_at')}) ORDER BY c.corrected_at,c.id)
    FROM attendance_corrections c WHERE c.company_id=s.company_id AND c.session_id=s.id),'[]'::jsonb) AS items
    FROM attendance_sessions s WHERE s.company_id=${scope.companyId} AND s.business_id=${scope.businessId}
      AND s.branch_id=${scope.branchId} AND s.id=${sessionId.toLowerCase()}`;
}
export async function attendanceCorrectionHistory(
  tx: Tx,
  scope: AttendanceBoardScope,
  sessionId: string,
): Promise<AttendanceCorrectionHistory | null> {
  const [row] = await tx.execute<{ items: unknown }>(
    attendanceCorrectionHistoryStatement(scope, sessionId),
  );
  return row ? view.parse(row) : null;
}
