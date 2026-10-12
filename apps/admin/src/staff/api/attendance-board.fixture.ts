import type {
  AttendanceBoard,
  AttendanceDeviceRefusalPage,
  WorkspaceBranch,
} from '@pospay/contracts';
import type { AttendanceBoardScope } from './use-attendance-board';
export const boardId = '01920000-0000-7000-8000-0000000000a2';
export const otherBoardId = '01920000-0000-7000-8000-0000000000a3';
export const boardScope: AttendanceBoardScope = {
  companyId: boardId,
  businessId: boardId,
  branchId: boardId,
  userId: boardId,
};
export const boardBranches: WorkspaceBranch[] = [
  {
    id: boardId,
    name_en: 'Synthetic branch',
    name_ar: null,
    is_active: true,
    effective_timezone: 'Asia/Kuwait',
  },
  {
    id: otherBoardId,
    name_en: 'Other synthetic branch',
    name_ar: null,
    is_active: true,
    effective_timezone: 'America/New_York',
  },
];
export const boardFixture: AttendanceBoard = {
  branch_id: boardId,
  date: '2026-10-11',
  timezone: 'Asia/Kuwait',
  generated_at: '2026-10-10T22:45:00Z',
  in_now: [
    {
      employee_id: boardId,
      name_en: 'Synthetic employee',
      name_ar: null,
      clock_in: '2026-10-10T20:00:00Z',
      source: 'QR',
      scheduled_end: '2026-10-11T04:00:00Z',
    },
  ],
  sessions: [
    {
      id: boardId,
      employee_id: otherBoardId,
      name_en: 'Synthetic manual employee',
      name_ar: null,
      clock_in: '2026-10-10T21:30:00Z',
      clock_out: '2026-10-11T02:00:00Z',
      status: 'MISSED_OUT',
      source: 'MANUAL',
      late_minutes: 12,
      scheduled_start: '2026-10-10T21:00:00Z',
      scheduled_end: '2026-10-11T02:00:00Z',
      geo: 'NONE',
      out_geo: null,
      corrected: true,
      revision: 1,
      open_exceptions: [
        { id: boardId, kind: 'NONE' },
        { id: otherBoardId, kind: 'OUT_OF_RANGE' },
        { id: '01920000-0000-7000-8000-0000000000a4', kind: 'SUSPECTED_MISSED_OUT' },
      ],
      manual: {
        change_request_id: boardId,
        requested_by: boardId,
        requested_by_name: null,
        approved_by: otherBoardId,
        approved_by_name: null,
      },
    },
  ],
};
export const refusalFixture: AttendanceDeviceRefusalPage = {
  items: [
    {
      id: boardId,
      employee_id: boardId,
      holder_employee_id: otherBoardId,
      employee: { id: boardId, name_ar: null, name_en: 'Synthetic employee' },
      holder: { id: otherBoardId, name_ar: null, name_en: 'Synthetic manual employee' },
      branch_id: boardId,
      step: 'CLOCK',
      reason: 'DEVICE_LOCKED',
      attempted_at: '2026-10-10T22:30:00Z',
    },
  ],
  next_cursor: `2026-10-10T22:30:00Z|${boardId}`,
};
