import { createHash } from 'node:crypto';
import { runIdempotent, type TenantWrappers, type IdGenerator } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type {
  AttendanceAssertionScope,
  AttendanceTransactions,
} from '../ports/clock-attendance.port.ts';
import type { ClockResult } from '../domain/clock-attendance.ts';
import { lockAttendanceState, lockedAttendanceContext } from './attendance-context.adapter.ts';
import { persistAttendance } from './attendance-writes.ts';

// أقفال State والهوية والربط تبقى مفتوحة عبر تحقق WebAuthn على pool منفصل؛ نفس حد كتابات الـ worker.
export const ATTENDANCE_TRANSACTION_TIMEOUT_MS = 10_000;

export function createAttendanceTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): AttendanceTransactions {
  return {
    run: (scope, scan, sample, work) =>
      database.withTenant(
        scope.companyId,
        async (tx) => {
          const state = await lockAttendanceState(tx, scope);
          const { context, at } = await lockedAttendanceContext(tx, scope, scan, sample, state);
          return work(
            {
              context,
              challenge: async (id) => {
                const [row] = await tx.execute<{ operation: 'CLOCK_IN' | 'CLOCK_OUT' }>(sql`
            SELECT operation FROM attendance_clock_challenges WHERE company_id=${scope.companyId} AND id=${id}
              AND business_id=${scope.businessId} AND employee_id=${scope.employeeId} AND user_id=${scope.userId}
              AND session_id=${scope.sessionId} AND branch_id=${scan.token.branch_id} AND binding_id=${context.bindingId}
              AND binding_revision=${context.bindingRevision} AND scan_digest=${context.qrContext}
              AND issued_at<=${at.toISOString()}::timestamptz AND issued_at>${at.toISOString()}::timestamptz-interval '120 seconds'`);
                return row === undefined
                  ? null
                  : {
                      ...scope,
                      bindingId: context.bindingId,
                      bindingRevision: context.bindingRevision,
                      passkeyId: context.passkeyId,
                      branchId: scan.token.branch_id,
                      operation: row.operation,
                      qrContext: context.qrContext,
                    };
              },
              storeChallenge: async (id: string, challenge: AttendanceAssertionScope) => {
                await tx.execute(sql`INSERT INTO attendance_clock_challenges(company_id,id,business_id,employee_id,branch_id,binding_id,binding_revision,user_id,session_id,operation,scan_digest,issued_at)
            VALUES(${scope.companyId},${id},${scope.businessId},${scope.employeeId},${challenge.branchId},${challenge.bindingId},${challenge.bindingRevision},${scope.userId},${scope.sessionId},${challenge.operation},${challenge.qrContext},${at.toISOString()})`);
              },
              idempotent: async (key, fingerprint, effect) => {
                const bound = createHash('sha256')
                  .update(
                    JSON.stringify([scope.userId, scope.employeeId, scope.sessionId, fingerprint]),
                  )
                  .digest('hex');
                const result = await runIdempotent(
                  tx,
                  { scope: 'COMPANY', operation: 'clock-attendance', key, fingerprint: bound },
                  async () => ({ status: 200, body: await effect() }),
                );
                return result.body as ClockResult;
              },
              persist: (write) => persistAttendance(tx, scope, scan, context, write, ids),
            },
            at,
          );
        },
        { userId: scope.userId, timeoutMs: ATTENDANCE_TRANSACTION_TIMEOUT_MS },
      ),
  };
}
