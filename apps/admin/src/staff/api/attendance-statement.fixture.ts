import type { AttendanceMonthlyReport } from '@pospay/contracts';
import { boardId, boardScope } from './attendance-board.fixture';

export const statementScope = { ...boardScope };
export const statementRenderId = '01920000-0000-7000-8000-0000000000c1';
export const statementMonth = '2026-10';

export const statementShifts = {
  shifts: [
    { start: '09:00', end: '20:00' },
    { start: '08:00', end: '16:00' },
  ],
};

export const statementReport: AttendanceMonthlyReport = {
  business_id: boardId,
  branch_id: boardId,
  month: statementMonth,
  rows: [
    {
      employee_id: boardId,
      name_ar: null,
      name_en: 'Synthetic employee',
      employee_number: 15,
      days_present: 20,
      worked_minutes: 9605,
      scheduled_minutes: 10080,
      contracted_minutes: 10200,
      leave: [],
      difference_minutes: -595,
      late_count: 2,
      late_minutes: 27,
      missing_clock_out: 1,
      manual_days: 3,
    },
    {
      employee_id: '01920000-0000-7000-8000-0000000000c2',
      name_ar: null,
      name_en: 'Other synthetic employee',
      employee_number: 16,
      days_present: 21,
      worked_minutes: 9700,
      scheduled_minutes: 9600,
      contracted_minutes: 9600,
      leave: [],
      difference_minutes: 100,
      late_count: 0,
      late_minutes: 0,
      missing_clock_out: 0,
      manual_days: 0,
    },
  ],
};

export const statementReady = { state: 'READY' } as const;
export const statementQueued = { state: 'QUEUED' } as const;
export const statementFailed = { state: 'FAILED', error_code: 'STATEMENT_EMPTY' } as const;
