import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { activeMembership } from '../../identity/index.ts';
import type { BranchPlaceReader } from '../ports/branch-place.port.ts';
import type { LockedShift } from '../ports/not-clocked-in.port.ts';
import type {
  DueShiftEnd,
  LockedShiftEnding,
  ShiftEndCursor,
  ShiftEndingSoonTransactions,
} from '../ports/shift-ending-soon.port.ts';
import { alertRules } from './alert-rule.adapter.ts';
import { branchManagerRecipientsAdapter } from './branch-manager-recipients.adapter.ts';
import {
  NOT_CLOCKED_IN_TRANSACTION_TIMEOUT_MS,
  lockEmployee,
  readLeaves,
  readShift,
} from './not-clocked-in.transactions.ts';
import { recordShiftEndingSoon, suppressShiftEndingSoon } from './shift-ending-soon-writes.ts';

type Moment = Date | string;

type DueShiftEndRow = {
  id: string;
  employee_id: string;
  starts_at: Moment;
  ends_at: Moment;
  business_id: string;
  branch_id: string;
  has_open_session: boolean;
};

// الوردية المنتهية ما بتتشتغلش (ends_at > now)، فيوم فات ما بيتقيّمش تاني.
// حد الست عشرة ساعة على starts_at يبقي مسح فهرس (company_id, starts_at) نطاقاً.
// الحضور عمود مش شرط: القاعدة المقفولة لازم تقفل كل المستحقين، شغالين أو غايبين (ADR-0053 قرار 8).
export function dueShiftEndsStatement(
  companyId: string,
  now: Date,
  after: ShiftEndCursor | null,
  limit: number,
) {
  const moment = now.toISOString();
  const page =
    after === null
      ? sql``
      : sql`AND (sh.starts_at, sh.employee_id) > (${after.startsAt.toISOString()}::timestamptz, ${after.employeeId}::uuid)`;
  return sql`SELECT sh.id, sh.employee_id, sh.starts_at, sh.ends_at, sc.business_id, sc.branch_id,
      EXISTS (SELECT 1 FROM attendance_sessions a
        WHERE a.company_id = sh.company_id AND a.employee_id = sh.employee_id
          AND a.status = 'OPEN' AND a.voided_at IS NULL) AS has_open_session
    FROM staff_schedule_shifts sh
    JOIN staff_schedules sc ON sc.company_id = sh.company_id AND sc.id = sh.schedule_id
    WHERE sh.company_id = ${companyId}
      AND sh.starts_at <= ${moment}::timestamptz
      AND sh.starts_at > (${moment}::timestamptz - interval '16 hours')
      AND sh.ends_at > ${moment}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM attendance_shift_ending_notices n
        WHERE n.company_id = sh.company_id AND n.employee_id = sh.employee_id
          AND n.shift_ends_at = sh.ends_at)
      ${page}
    ORDER BY sh.starts_at, sh.employee_id
    LIMIT ${limit}`;
}

export function openSessionStatement(companyId: string, employeeId: string) {
  return sql`SELECT 1 FROM attendance_sessions
    WHERE company_id = ${companyId} AND employee_id = ${employeeId}
      AND status = 'OPEN' AND voided_at IS NULL
    LIMIT 1`;
}

/**
 * فروع الموظفة في يوم العمل: فرعها الأساسي شاملاً، وارتباطاتها النشطة في النهار ده.
 * القاعدة هي قاعدة الجلسة الشخصية: العضوية لازم تغطّي أي فرع منهم (ADR-0052 §5).
 */
export function employeeBranchesStatement(
  companyId: string,
  employeeId: string,
  workingDate: string,
) {
  return sql`SELECT primary_branch_id AS branch_id FROM employees
      WHERE company_id = ${companyId} AND id = ${employeeId}
    UNION
    SELECT branch_id FROM employee_branches
      WHERE company_id = ${companyId} AND employee_id = ${employeeId}
        AND "from" <= ${workingDate}::date AND ("to" IS NULL OR "to" > ${workingDate}::date)`;
}

export function shiftEndingSoonTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  places: BranchPlaceReader<Tx>,
): ShiftEndingSoonTransactions {
  const options = { timeoutMs: NOT_CLOCKED_IN_TRANSACTION_TIMEOUT_MS };
  return {
    candidates: (companyId, now, after, limit) =>
      database.withTenant(
        companyId,
        async (tx) => {
          if (!(await branchManagerRecipientsAdapter.companyOpen(tx, companyId))) return [];
          const rows = await tx.execute<DueShiftEndRow>(
            dueShiftEndsStatement(companyId, now, after, limit),
          );
          return rows.map(toDueShiftEnd);
        },
        options,
      ),
    rule: (companyId, scope, kind) =>
      database.withTenant(
        companyId,
        async (tx) => alertRules(tx).rule(companyId, scope, kind),
        options,
      ),
    run: (companyId, employeeId, sample, work) =>
      database.withTenant(
        companyId,
        async (tx) => {
          await lockEmployee(tx, companyId, employeeId);
          const at = sample();
          return work(locked(tx, ids, companyId, employeeId, places), at);
        },
        options,
      ),
  };
}

function locked(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  employeeId: string,
  places: BranchPlaceReader<Tx>,
): LockedShiftEnding {
  return {
    rules: alertRules(tx),
    shift: (shiftId) => readShift(tx, companyId, employeeId, shiftId, places),
    approvedLeaves: (id, from, to, workingDate) =>
      readLeaves(tx, companyId, id, from, to, workingDate),
    hasOpenSession: (id) => hasOpenSession(tx, companyId, id),
    userHasAccess: (userId, shift, moment) => userHasAccess(tx, companyId, userId, shift, moment),
    record: (notice) => recordShiftEndingSoon(tx, ids, companyId, notice),
    suppress: (write) => suppressShiftEndingSoon(tx, ids, companyId, write),
  };
}

async function hasOpenSession(tx: Tx, companyId: string, employeeId: string): Promise<boolean> {
  const rows = await tx.execute<{ one: number }>(openSessionStatement(companyId, employeeId));
  return rows.length > 0;
}

// الموظفة ليها حساب بس عضويتها في الشركة انتهت أو مغطّاش نطاقها: مفيش إشعار يوصلها (ADR-0052 §5).
// فروعها تُقرأ من جداول staff نفسها على نفس المعاملة، من غير اتصال جديد.
async function userHasAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  shift: LockedShift,
  at: Date,
): Promise<boolean> {
  const rows = await tx.execute<{ branch_id: string }>(
    employeeBranchesStatement(companyId, shift.employeeId, shift.workingDate),
  );
  return activeMembership(tx, companyId, userId, at, {
    businessId: shift.businessId,
    branchIds: rows.map((row) => row.branch_id),
  });
}

function toDueShiftEnd(row: DueShiftEndRow): DueShiftEnd {
  return {
    id: row.id,
    employeeId: row.employee_id,
    startsAt: instant(row.starts_at),
    endsAt: instant(row.ends_at),
    businessId: row.business_id,
    branchId: row.branch_id,
    hasOpenSession: row.has_open_session,
  };
}

function instant(value: Moment): Date {
  return value instanceof Date ? value : new Date(value);
}
