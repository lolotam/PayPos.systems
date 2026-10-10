import { t } from '@pospay/i18n';
import type postgres from 'postgres';
import { branchPlaceAdapter } from '../persistence/branch-place.adapter.ts';
import { breakNotReturnedTransactions } from '../persistence/break-not-returned.transactions.ts';
import type { BreakNotReturnedTransactions } from '../ports/break-not-returned.port.ts';
import { DetectBreakNotReturned } from '../use-cases/detect-break-not-returned/detect-break-not-returned.ts';
import {
  notClockedInFixture,
  SHIFT_END,
  SHIFT_START,
  WORKING,
  type NotClockedInFixture,
  type Tenant,
} from './not-clocked-in.fixture.ts';

// الوردية 10:00–18:00 بتوقيت الكويت (07:00–15:00Z)، والبريك 13:00–14:00 (10:00–11:00Z).
export const BREAK_START = new Date('2026-10-04T10:00:00.000Z');
export const BREAK_END = new Date('2026-10-04T11:00:00.000Z');
export const BREAK_ALERT_AT = new Date('2026-10-04T11:10:00.000Z');
export const MORNING_IN = new Date('2026-10-04T06:58:00.000Z');
export const BREAK_OUT = new Date('2026-10-04T10:02:00.000Z');

const NAME_FALLBACK = {
  employeeAr: t('ar', 'inApp.generic_employee'),
  employeeEn: t('en', 'inApp.generic_employee'),
  branchAr: t('ar', 'inApp.generic_branch'),
  branchEn: t('en', 'inApp.generic_branch'),
};

export interface SessionInput {
  readonly clockIn: Date;
  readonly clockOut?: Date | null;
  readonly status?: 'OPEN' | 'CLOSED' | 'MISSED_OUT';
  readonly branch?: string;
  readonly scheduledEnd?: Date | null;
}

/** ما يضيفه فكسشر البريك فوق فكسشر عدم الحضور. */
export interface BreakFixtureExtras {
  readonly breakFailures: unknown[];
  readonly breakTransactions: BreakNotReturnedTransactions;
  setNow(at: Date): void;
  detectBreak(port?: BreakNotReturnedTransactions): DetectBreakNotReturned;
  breakShift(tenant: Tenant, employeeId: string, withBreak?: boolean): Promise<string>;
  session(tenant: Tenant, employeeId: string, input: SessionInput): Promise<void>;
  breakNotices(company: string, employeeId: string): Promise<postgres.RowList<postgres.Row[]>>;
  breakEvents(company: string): Promise<postgres.RowList<postgres.Row[]>>;
}
export type BreakNotReturnedFixture = NotClockedInFixture & BreakFixtureExtras;

/** فكسشر تنبيه عدم الحضور نفسه، مع وردية فيها بريك وجلسات مقفولة ودفتر عدم الرجوع. */
export async function breakNotReturnedFixture(): Promise<BreakNotReturnedFixture> {
  const base = await notClockedInFixture();
  const { owner, ids } = base;
  const transactions = breakNotReturnedTransactions(base.db, ids, branchPlaceAdapter);
  let instant = BREAK_ALERT_AT;
  const failures: unknown[] = [];
  const clock = { now: () => new Date(instant) };
  const diagnostics = { failed: (_companyId: string, error: unknown) => { failures.push(error); } };
  return {
    ...base,
    breakFailures: failures,
    breakTransactions: transactions,
    setNow: (at: Date) => {
      instant = at;
      base.setNow(at);
    },
    detectBreak: (port: BreakNotReturnedTransactions = transactions) =>
      new DetectBreakNotReturned(port, clock, NAME_FALLBACK, diagnostics),
    breakShift: async (tenant: Tenant, employeeId: string, withBreak = true) => {
      const shift = await base.shift(tenant, employeeId);
      if (withBreak)
        await owner`UPDATE staff_schedule_shifts SET break_start='13:00', break_end='14:00',
          break_starts_at=${BREAK_START}, break_ends_at=${BREAK_END}
          WHERE company_id=${tenant.company} AND id=${shift}`;
      return shift;
    },
    session: async (tenant: Tenant, employeeId: string, input: SessionInput) => {
      const status = input.status ?? (input.clockOut == null ? 'OPEN' : 'CLOSED');
      const closedBy = status === 'OPEN' ? null : status === 'CLOSED' ? 'EMPLOYEE' : 'MISSED_OUT';
      const scheduledEnd = input.scheduledEnd === undefined ? SHIFT_END : input.scheduledEnd;
      await owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
        clock_in,clock_out,status,closed_by,source,geo,late_minutes,scheduled_start,scheduled_end)
        VALUES(${tenant.company},${ids.newId()},${tenant.business},${input.branch ?? tenant.branch},${employeeId},
          ${WORKING},'Asia/Kuwait',${input.clockIn},${input.clockOut ?? null},${status},${closedBy},'QR','OK',0,
          ${scheduledEnd === null ? null : SHIFT_START},${scheduledEnd})`;
    },
    breakNotices: (company: string, employeeId: string) =>
      owner`SELECT id, recipient_count, shift_starts_at, break_ends_at, break_out_at, alert_due_at
        FROM attendance_break_not_returned_notices
        WHERE company_id=${company} AND employee_id=${employeeId} ORDER BY shift_starts_at`,
    breakEvents: (company: string) =>
      owner`SELECT id, payload FROM outbox WHERE company_id=${company} AND event_type='ShiftBreakNotReturned' ORDER BY seq`,

  };
}
