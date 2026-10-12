import type { AttendanceMonthlyReport } from '@pospay/contracts';
import { boardId, otherBoardId, boardScope } from './attendance-board.fixture';
export const reportScope = { ...boardScope };
export const reportMonth = '2026-10';
export const reportFixture: AttendanceMonthlyReport = {
  business_id: boardId,
  branch_id: boardId,
  month: reportMonth,
  rows: [
    {
      employee_id: boardId,
      name_ar: null,
      name_en: 'Synthetic employee',
      days_present: 20,
      worked_minutes: 9605,
      scheduled_minutes: 10080,
      contracted_minutes: 10200,
      leave: [
        { type: 'ANNUAL', days: 2, partial_minutes: 90 },
        { type: 'SICK', days: 1, partial_minutes: 30 },
        { type: 'UNPAID', days: 3, partial_minutes: 45 },
        { type: 'OTHER', days: 4, partial_minutes: 120 },
      ],
      difference_minutes: -595,
      late_count: 2,
      late_minutes: 27,
      missing_clock_out: 1,
      manual_days: 3,
    },
    {
      employee_id: otherBoardId,
      name_ar: null,
      name_en: 'Other synthetic employee',
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
