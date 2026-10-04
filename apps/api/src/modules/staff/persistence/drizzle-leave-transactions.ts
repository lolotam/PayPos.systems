import {
  runIdempotent,
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  type TenantWrappers,
  type IdGenerator,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { scheduleToday } from '../domain/schedule-calendar.ts';
import { validateLeaveEmployee } from '../domain/leave-policy.ts';
import { LeaveError, type LeaveRecord } from '../domain/leave-types.ts';
import type {
  LeaveActor,
  LeaveClock,
  LeaveTransactions,
} from '../ports/leave-transactions.port.ts';
import {
  leaveAuthority,
  leaveAuthorityLock,
  leaveBusinessContext,
} from './leave-context.adapter.ts';
import { lockedLeaveEmployee, lockedLeaveRecord } from './leave-records.ts';
import { saveLeave } from './leave-writes.ts';

async function resolve(tx: Tx, actor: LeaveActor, action: 'create' | 'cancel', clock: LeaveClock) {
  if (!(await leaveAuthorityLock(tx, actor.companyId))) throw new LeaveError('NOT_FOUND');
  const employee = await lockedLeaveEmployee(tx, actor);
  const before = await lockedLeaveRecord(tx, actor, employee.id);
  const branchId = before?.branch_id ?? actor.branchId;
  if (!branchId) throw new LeaveError('NOT_FOUND');
  if (actor.own && before !== null && before.requested_by !== actor.userId)
    throw new LeaveError('NOT_FOUND');
  const business = await leaveBusinessContext(tx, actor.companyId, actor.businessId);
  // الذات تثبت أهليتها في الفرع الحالي الموثق؛ لا تفقد حق إلغاء طلبها بعد نقل الفرع.
  const authorityBranch = actor.own ? actor.branchId : branchId;
  // تعطيل الفرع يوقف الطلب الجديد، لكنه لا يسحب حق المدير في إلغاء طلب معلق داخل نطاقه.
  const branch = business?.branches.find(
    (b) => b.id === authorityBranch && (b.is_active || (action === 'cancel' && !actor.own)),
  );
  if (!branch) throw new LeaveError('NOT_FOUND');
  // لا نحفظ وقتاً قبل انتظار الأقفال؛ المنحة قد تنتهي والطلب ما زال في الطابور.
  const now = clock.now();
  const access = await leaveAuthority(
    tx,
    actor.companyId,
    actor.userId,
    actor.businessId,
    [branch.id],
    now,
    actor.own ? (employee.user_id ?? '') : undefined,
  );
  if (!access[action].includes(branch.id)) throw new LeaveError('NOT_FOUND');
  // علاقة الموظف بالنطاق تسبق أخطاء الأهلية، حتى لا تكشف وجود موظف في فرع آخر.
  if (
    !employee.attachments.some((a) => a.branch_id === branch.id) ||
    (actor.own && employee.user_id !== actor.userId)
  )
    throw new LeaveError('NOT_FOUND');
  if (!access.featureEnabled) throw new LeaveError('FEATURE_DISABLED');
  if (actor.own) {
    const today = scheduleToday(now, branch.effective_timezone);
    try {
      validateLeaveEmployee(employee, branch.id, { from: today, to: today });
    } catch {
      throw new LeaveError('NOT_FOUND');
    }
  }
  return {
    employee,
    before,
    branchId,
    timezone: before?.timezone ?? branch.effective_timezone,
    now,
  };
}
function persistenceError(error: unknown): never {
  if (
    error instanceof LeaveError ||
    error instanceof IdempotencyKeyBusyError ||
    error instanceof IdempotencyKeyReusedError
  )
    throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    if (cause.code === '23P01') throw new LeaveError('LEAVE_OVERLAP');
    if (['40001', '40P01', '55P03'].includes(String(cause.code)))
      throw new LeaveError('TRANSACTION_RETRY_REQUIRED');
  }
  throw new Error('LEAVE_PERSISTENCE_FAILED', { cause: error });
}
export function createLeaveTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): LeaveTransactions {
  return {
    run: async (actor, action, clock, work) => {
      try {
        return await database.withTenant(
          actor.companyId,
          async (tx) => {
            const context = await resolve(tx, actor, action, clock);
            const fingerprint = createHash('sha256')
              .update(
                JSON.stringify([
                  actor.userId,
                  actor.businessId,
                  context.employee.id,
                  context.branchId,
                  actor.own,
                  actor.fingerprint,
                ]),
              )
              .digest('hex');
            const result = await runIdempotent(
              tx,
              {
                scope: 'COMPANY',
                operation: `${action === 'create' ? 'request' : 'cancel'}-leave`,
                key: actor.key,
                fingerprint,
              },
              async () => {
                const row = await work({
                  ...context,
                  overlaps: (period) =>
                    tx.execute<
                      Pick<LeaveRecord, 'starts_at' | 'ends_at' | 'status'>
                    >(sql`SELECT to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at,to_char(ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ends_at,status FROM leave_requests
                WHERE company_id=${actor.companyId} AND employee_id=${context.employee.id} AND status IN ('PENDING','APPROVED') AND starts_at<${period.ends_at}::timestamptz AND ends_at>${period.starts_at}::timestamptz`),
                  save: (row) => saveLeave(tx, actor.companyId, ids, context.before, row),
                });
                return { status: action === 'create' ? 201 : 200, body: row };
              },
            );
            return result.body as LeaveRecord;
          },
          { userId: actor.userId },
        );
      } catch (error) {
        persistenceError(error);
      }
    },
  };
}
