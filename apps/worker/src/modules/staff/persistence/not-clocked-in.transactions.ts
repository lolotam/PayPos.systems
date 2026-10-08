import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { LeaveInterval, PresenceSession } from '../domain/not-clocked-in.ts';
import type { BranchPlace, BranchPlaceReader } from '../ports/branch-place.port.ts';
import type {
  DueShift,
  LockedNotClockedIn,
  LockedShift,
  NotClockedInCursor,
  NotClockedInTransactions,
} from '../ports/not-clocked-in.port.ts';
import { branchManagerRecipientsAdapter } from './branch-manager-recipients.adapter.ts';
import { recordNotClockedIn } from './not-clocked-in-writes.ts';

export const NOT_CLOCKED_IN_TRANSACTION_TIMEOUT_MS = 15_000;

type DueRow = {
  id: string;
  employee_id: string;
  starts_at: Date | string;
  ends_at: Date | string;
};

type ShiftRow = DueRow & {
  working_date: string | Date;
  business_id: string;
  branch_id: string;
  deleted_at: Date | string | null;
  contract_end: string | Date | null;
  user_id: string | null;
  name_ar: string | null;
  name_en: string;
  timezone: string;
};

// قيد staff_schedule_shifts_duration يمنع وردية أطول من ١٦ ساعة (ends_at <= starts_at + interval '16 hours')،
// فالتي لم تنتهِ بعد endsAfter لا تكون قد بدأت عند تلك اللحظة ناقص ١٦ ساعة أو قبلها. الحد يبقي مسح الفهرس نطاقاً.
export function dueShiftsStatement(
  companyId: string,
  startsAtOrBefore: Date,
  endsAfter: Date,
  after: NotClockedInCursor | null,
  limit: number,
) {
  const page =
    after === null
      ? sql``
      : sql`AND (sh.starts_at, sh.id) > (${after.startsAt.toISOString()}::timestamptz, ${after.id}::uuid)`;
  return sql`SELECT sh.id, sh.employee_id, sh.starts_at, sh.ends_at
    FROM staff_schedule_shifts sh
    WHERE sh.company_id = ${companyId}
      AND sh.starts_at <= ${startsAtOrBefore.toISOString()}::timestamptz
      AND sh.starts_at > (${endsAfter.toISOString()}::timestamptz - interval '16 hours')
      AND sh.ends_at > ${endsAfter.toISOString()}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM attendance_not_clocked_in_notices n
        WHERE n.company_id = sh.company_id AND n.employee_id = sh.employee_id
          AND n.shift_starts_at = sh.starts_at)
      ${page}
    ORDER BY sh.starts_at, sh.id
    LIMIT ${limit}`;
}

export function approvedLeavesStatement(
  companyId: string,
  employeeId: string,
  startsAt: Date,
  endsAt: Date,
  workingDate: string,
) {
  return sql`SELECT starts_at, ends_at, status, kind, "from", "to" FROM leave_requests
    WHERE company_id = ${companyId} AND employee_id = ${employeeId} AND status = 'APPROVED'
      AND ((kind = 'FULL_DAY' AND "from" <= ${workingDate}::date AND "to" >= ${workingDate}::date)
        OR (starts_at < ${endsAt.toISOString()}::timestamptz
          AND ends_at > ${startsAt.toISOString()}::timestamptz))
    ORDER BY starts_at, ends_at`;
}

export function countingClockInsStatement(
  companyId: string,
  employeeId: string,
  from: Date,
  to: Date,
) {
  return sql`SELECT clock_in FROM attendance_sessions
    WHERE company_id = ${companyId} AND employee_id = ${employeeId}
      AND working_date BETWEEN ((${from.toISOString()}::timestamptz AT TIME ZONE 'UTC')::date - 1)
        AND ((${to.toISOString()}::timestamptz AT TIME ZONE 'UTC')::date + 1)
      AND clock_in >= ${from.toISOString()}::timestamptz
      AND clock_in <= ${to.toISOString()}::timestamptz`;
}

export function notClockedInTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  places: BranchPlaceReader<Tx>,
): NotClockedInTransactions {
  return {
    candidates: (companyId, startsAtOrBefore, endsAfter, after, limit) =>
      database.withTenant(
        companyId,
        async (tx) => {
          if (!(await branchManagerRecipientsAdapter.companyOpen(tx, companyId))) return [];
          const rows = await tx.execute<DueRow>(
            dueShiftsStatement(companyId, startsAtOrBefore, endsAfter, after, limit),
          );
          return rows.map(toDueShift);
        },
        { timeoutMs: NOT_CLOCKED_IN_TRANSACTION_TIMEOUT_MS },
      ),
    run: (companyId, employeeId, sample, work) =>
      database.withTenant(
        companyId,
        async (tx) => {
          await lockEmployee(tx, companyId, employeeId);
          const at = sample();
          return work(locked(tx, ids, companyId, employeeId, at, places), at);
        },
        { timeoutMs: NOT_CLOCKED_IN_TRANSACTION_TIMEOUT_MS },
      ),
  };
}

function locked(
  tx: Tx,
  ids: IdGenerator,
  companyId: string,
  employeeId: string,
  at: Date,
  places: BranchPlaceReader<Tx>,
): LockedNotClockedIn {
  return {
    shift: (shiftId) => readShift(tx, companyId, employeeId, shiftId, places),
    approvedLeaves: (id, startsAt, endsAt, workingDate) =>
      readLeaves(tx, companyId, id, startsAt, endsAt, workingDate),
    presenceSession: (id, alertAt) => readPresenceSession(tx, companyId, id, alertAt),
    clockIns: (id, from, to) => readClockIns(tx, companyId, id, from, to),
    managers: (businessId, branchId, roles) =>
      branchManagerRecipientsAdapter.forBranch(tx, companyId, businessId, branchId, at, roles),
    record: (notice) => recordNotClockedIn(tx, ids, companyId, notice),
  };
}

async function lockEmployee(tx: Tx, companyId: string, employeeId: string): Promise<void> {
  await tx.execute(sql`
    SELECT employee_id FROM attendance_states
    WHERE company_id = ${companyId} AND employee_id = ${employeeId} FOR UPDATE`);
  // قفل employees يمنع حفظ الجدول من تغيير الوردية بين إعادة قراءتها وتثبيت التنبيه.
  // الترتيب attendance_states ثم employees يوافق مسح QR/الكارت؛ correct-attendance يأخذ الحالة ثم الجلسة ثم الموظف.
  // missed-out يأخذ الحالة ولا يقفل الموظف، وresolve يأخذ الاستثناء ثم الموظف ولا يطلب الحالة.
  // حفظ الجدول يقفل الموظف فقط دون الحالة، وهذه المهمة لا تقفل جلسة أو استثناء؛ فلا تنشأ دورة انتظار بهذه الإضافة.
  await tx.execute(sql`
    SELECT id FROM employees
    WHERE company_id = ${companyId} AND id = ${employeeId} FOR SHARE`);
}

async function readShift(
  tx: Tx,
  companyId: string,
  employeeId: string,
  shiftId: string,
  places: BranchPlaceReader<Tx>,
): Promise<LockedShift | null> {
  if (!(await branchManagerRecipientsAdapter.companyOpen(tx, companyId))) return null;
  const [row] = await tx.execute<ShiftRow>(sql`
    SELECT sh.id, sh.employee_id, sh.working_date, sh.starts_at, sh.ends_at,
      sc.business_id, sc.branch_id, sc.timezone, e.deleted_at, e.contract_end, e.user_id, e.name_ar, e.name_en
    FROM staff_schedule_shifts sh
    JOIN staff_schedules sc ON sc.company_id = sh.company_id AND sc.id = sh.schedule_id AND sc.employee_id = sh.employee_id
    JOIN employees e ON e.company_id = sh.company_id AND e.business_id = sc.business_id AND e.id = sh.employee_id
    WHERE sh.company_id = ${companyId} AND sh.id = ${shiftId} AND sh.employee_id = ${employeeId}`);
  if (row === undefined) return null;
  const place = await places.forBranch(tx, companyId, row.business_id, row.branch_id);
  return place === null ? null : toLockedShift(row, place);
}

async function readLeaves(
  tx: Tx,
  companyId: string,
  employeeId: string,
  startsAt: Date,
  endsAt: Date,
  workingDate: string,
): Promise<readonly LeaveInterval[]> {
  const rows = await tx.execute<{
    starts_at: Date | string;
    ends_at: Date | string;
    status: string;
    kind: LeaveInterval['kind'];
    from: string | Date;
    to: string | Date;
  }>(approvedLeavesStatement(companyId, employeeId, startsAt, endsAt, workingDate));
  return rows.map((row) => ({
    status: row.status,
    kind: row.kind,
    from: day(row.from),
    to: day(row.to),
    startsAt: instant(row.starts_at),
    endsAt: instant(row.ends_at),
  }));
}

export function presenceSessionStatement(companyId: string, employeeId: string, alertAt: Date) {
  return sql`SELECT clock_in, clock_out, status
    FROM attendance_sessions WHERE company_id = ${companyId} AND employee_id = ${employeeId}
      AND status = 'OPEN' AND clock_in <= ${alertAt.toISOString()}::timestamptz
    UNION ALL
    SELECT clock_in, clock_out, status
    FROM attendance_sessions WHERE company_id = ${companyId} AND employee_id = ${employeeId}
      AND status <> 'OPEN' AND clock_in <= ${alertAt.toISOString()}::timestamptz
      AND clock_out > ${alertAt.toISOString()}::timestamptz
    LIMIT 1`;
}

async function readPresenceSession(
  tx: Tx, companyId: string, employeeId: string, alertAt: Date,
): Promise<PresenceSession | null> {
  const [row] = await tx.execute<{
    clock_in: Date | string; clock_out: Date | string | null; status: string;
  }>(
    presenceSessionStatement(companyId, employeeId, alertAt),
  );
  return row === undefined ? null : {
    clockIn: instant(row.clock_in),
    clockOut: row.clock_out === null ? null : instant(row.clock_out),
    status: row.status,
  };
}

async function readClockIns(
  tx: Tx,
  companyId: string,
  employeeId: string,
  from: Date,
  to: Date,
): Promise<readonly Date[]> {
  const rows = await tx.execute<{ clock_in: Date | string }>(
    countingClockInsStatement(companyId, employeeId, from, to),
  );
  return rows.map((row) => instant(row.clock_in));
}

function toDueShift(row: DueRow): DueShift {
  return {
    id: row.id,
    employeeId: row.employee_id,
    startsAt: instant(row.starts_at),
    endsAt: instant(row.ends_at),
  };
}

function toLockedShift(row: ShiftRow, place: BranchPlace): LockedShift {
  return {
    ...toDueShift(row),
    businessId: row.business_id,
    branchId: row.branch_id,
    workingDate: day(row.working_date),
    deleted: row.deleted_at !== null,
    contractEnd: row.contract_end === null ? null : day(row.contract_end),
    employeeUserId: row.user_id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    branchNameAr: place.nameAr,
    branchNameEn: place.nameEn,
    timeZone: row.timezone,
  };
}

function instant(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function day(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}
