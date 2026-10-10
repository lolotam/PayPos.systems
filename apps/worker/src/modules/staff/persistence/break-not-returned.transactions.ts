import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { BranchPlaceReader } from '../ports/branch-place.port.ts';
import type {
  BreakNotReturnedTransactions,
  DueBreak,
  LockedBreakNotReturned,
  LockedBreakShift,
} from '../ports/break-not-returned.port.ts';
import type { NotClockedInCursor } from '../ports/not-clocked-in.port.ts';
import { branchManagerRecipientsAdapter } from './branch-manager-recipients.adapter.ts';
import { recordBreakNotReturned } from './break-not-returned-writes.ts';
import {
  NOT_CLOCKED_IN_TRANSACTION_TIMEOUT_MS,
  lockEmployee,
  readLeaves,
} from './not-clocked-in.transactions.ts';

type Moment = Date | string;

type ShiftRow = {
  id: string;
  employee_id: string;
  working_date: string | Date;
  starts_at: Moment;
  ends_at: Moment;
  break_starts_at: Moment | null;
  break_ends_at: Moment | null;
  business_id: string;
  branch_id: string;
  timezone: string;
  deleted_at: Moment | null;
  contract_end: string | Date | null;
  user_id: string | null;
  name_ar: string | null;
  name_en: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// حد يوم العمل لازم يبقى ثابت: sh.working_date - 1 مش leakproof تحت RLS فبيفضل Filter ومايدخلش شرط الفهرس.
// الهامش يوم UTC من كل ناحية يغطي أي توقيت فرع.
function dayAround(at: Date, days: number): string {
  return new Date(at.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

// الوردية المنتهية مابتتقراش (ends_at > now)، فيوم فات مايتقيّمش تاني حتى لو اتضافت له جلسة يدوية بعدين.
// حد الست عشرة ساعة على starts_at يبقي مسح فهرس (company_id, starts_at) نطاقاً.
export function dueBreaksStatement(
  companyId: string,
  breakEndsAtOrBefore: Date,
  endsAfter: Date,
  after: NotClockedInCursor | null,
  limit: number,
) {
  const page =
    after === null
      ? sql``
      : sql`AND (sh.starts_at, sh.id) > (${after.startsAt.toISOString()}::timestamptz, ${after.id}::uuid)`;
  return sql`SELECT sh.id, sh.employee_id, sh.starts_at
    FROM staff_schedule_shifts sh
    JOIN staff_schedules sc ON sc.company_id = sh.company_id AND sc.id = sh.schedule_id
    WHERE sh.company_id = ${companyId}
      AND sh.starts_at <= ${breakEndsAtOrBefore.toISOString()}::timestamptz
      AND sh.starts_at > (${endsAfter.toISOString()}::timestamptz - interval '16 hours')
      AND sh.ends_at > ${endsAfter.toISOString()}::timestamptz
      AND sh.break_ends_at <= ${breakEndsAtOrBefore.toISOString()}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM attendance_break_not_returned_notices n
        WHERE n.company_id = sh.company_id AND n.employee_id = sh.employee_id
          AND n.shift_starts_at = sh.starts_at)
      AND EXISTS (SELECT 1 FROM attendance_sessions a
        WHERE a.company_id = sh.company_id AND a.employee_id = sh.employee_id
          AND a.working_date BETWEEN ${dayAround(endsAfter, -2)}::date AND ${dayAround(endsAfter, 1)}::date
          AND a.branch_id = sc.branch_id AND a.scheduled_end = sh.ends_at AND a.status = 'CLOSED'
          AND a.clock_out >= sh.break_starts_at AND a.clock_out < sh.break_ends_at)
      ${page}
    ORDER BY sh.starts_at, sh.id
    LIMIT ${limit}`;
}

// الخروج لازم يكون جلسة قفلتها الموظفة بنفسها على نفس الوردية والفرع (رابط 16b-2: scheduled_end = ends_at).
export function breakOutStatement(companyId: string, shift: LockedBreakShift) {
  if (shift.breakStartsAt === null || shift.breakEndsAt === null)
    return sql`SELECT NULL::timestamptz AS clock_out`;
  return sql`SELECT max(clock_out) AS clock_out FROM attendance_sessions
    WHERE company_id = ${companyId} AND employee_id = ${shift.employeeId}
      AND working_date BETWEEN ${dayAround(shift.startsAt, -2)}::date AND ${dayAround(shift.endsAt, 1)}::date
      AND branch_id = ${shift.branchId} AND scheduled_end = ${shift.endsAt.toISOString()}::timestamptz
      AND status = 'CLOSED'
      AND clock_out >= ${shift.breakStartsAt.toISOString()}::timestamptz
      AND clock_out < ${shift.breakEndsAt.toISOString()}::timestamptz`;
}

// أي جلسة في فرع الوردية بدأت بعد خروج البريك ولحد لحظة القرار رجوع؛ الحالات معدودة عشان حالة جديدة ماتتحسبش رجوع.
export function returnedStatement(
  companyId: string,
  shift: LockedBreakShift,
  from: Date,
  to: Date,
) {
  return sql`SELECT EXISTS (SELECT 1 FROM attendance_sessions
    WHERE company_id = ${companyId} AND employee_id = ${shift.employeeId}
      AND working_date BETWEEN ${dayAround(shift.startsAt, -1)}::date AND ${dayAround(shift.endsAt, 1)}::date
      AND branch_id = ${shift.branchId} AND status IN ('OPEN', 'CLOSED', 'MISSED_OUT')
      AND clock_in >= ${from.toISOString()}::timestamptz
      AND clock_in <= ${to.toISOString()}::timestamptz) AS returned`;
}

export function breakNotReturnedTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  places: BranchPlaceReader<Tx>,
): BreakNotReturnedTransactions {
  const options = { timeoutMs: NOT_CLOCKED_IN_TRANSACTION_TIMEOUT_MS };
  return {
    candidates: (companyId, breakEndsAtOrBefore, endsAfter, after, limit) =>
      database.withTenant(
        companyId,
        async (tx) => {
          if (!(await branchManagerRecipientsAdapter.companyOpen(tx, companyId))) return [];
          const rows = await tx.execute<{ id: string; employee_id: string; starts_at: Moment }>(
            dueBreaksStatement(companyId, breakEndsAtOrBefore, endsAfter, after, limit),
          );
          return rows.map(toDueBreak);
        },
        options,
      ),
    run: (companyId, employeeId, sample, work) =>
      database.withTenant(
        companyId,
        async (tx) => {
          await lockEmployee(tx, companyId, employeeId);
          const at = sample();
          return work(locked(tx, ids, companyId, employeeId, at, places), at);
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
  at: Date,
  places: BranchPlaceReader<Tx>,
): LockedBreakNotReturned {
  return {
    shift: (shiftId) => readShift(tx, companyId, employeeId, shiftId, places),
    approvedLeaves: (id, from, to, workingDate) =>
      readLeaves(tx, companyId, id, from, to, workingDate),
    breakOut: async (shift) => {
      const [row] = await tx.execute<{ clock_out: Moment | null }>(
        breakOutStatement(companyId, shift),
      );
      return row?.clock_out == null ? null : instant(row.clock_out);
    },
    returned: async (shift, from, to) => {
      const [row] = await tx.execute<{ returned: boolean }>(
        returnedStatement(companyId, shift, from, to),
      );
      return row?.returned === true;
    },
    managers: (businessId, branchId, roles) =>
      branchManagerRecipientsAdapter.forBranch(tx, companyId, businessId, branchId, at, roles),
    record: (notice) => recordBreakNotReturned(tx, ids, companyId, notice),
  };
}

async function readShift(
  tx: Tx,
  companyId: string,
  employeeId: string,
  shiftId: string,
  places: BranchPlaceReader<Tx>,
): Promise<LockedBreakShift | null> {
  if (!(await branchManagerRecipientsAdapter.companyOpen(tx, companyId))) return null;
  const [row] = await tx.execute<ShiftRow>(sql`
    SELECT sh.id, sh.employee_id, sh.working_date, sh.starts_at, sh.ends_at, sh.break_starts_at, sh.break_ends_at,
      sc.business_id, sc.branch_id, sc.timezone, e.deleted_at, e.contract_end, e.user_id, e.name_ar, e.name_en
    FROM staff_schedule_shifts sh
    JOIN staff_schedules sc ON sc.company_id = sh.company_id AND sc.id = sh.schedule_id AND sc.employee_id = sh.employee_id
    JOIN employees e ON e.company_id = sh.company_id AND e.business_id = sc.business_id AND e.id = sh.employee_id
    WHERE sh.company_id = ${companyId} AND sh.id = ${shiftId} AND sh.employee_id = ${employeeId}`);
  if (row === undefined) return null;
  const place = await places.forBranch(tx, companyId, row.business_id, row.branch_id);
  if (place === null) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    startsAt: instant(row.starts_at),
    endsAt: instant(row.ends_at),
    breakStartsAt: row.break_starts_at === null ? null : instant(row.break_starts_at),
    breakEndsAt: row.break_ends_at === null ? null : instant(row.break_ends_at),
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

function toDueBreak(row: { id: string; employee_id: string; starts_at: Moment }): DueBreak {
  return { id: row.id, employeeId: row.employee_id, startsAt: instant(row.starts_at) };
}

function instant(value: Moment): Date {
  return value instanceof Date ? value : new Date(value);
}

function day(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}
