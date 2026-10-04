import { expect, it } from 'vitest';
import {
  requestLeaveInput,
  requestEmployeeLeaveInput,
  cancelLeaveInput,
  leaveRequest,
} from '../staff/leave.js';
const full = { kind: 'FULL_DAY', from: '2026-10-04', to: '2026-10-05', type: 'ANNUAL' };
it('validates full/partial and trims OTHER note', () => {
  expect(requestLeaveInput.parse(full)).toEqual(full);
  expect(
    requestLeaveInput.parse({
      kind: 'PARTIAL',
      date: full.from,
      start: '09:00',
      end: '10:00',
      type: 'OTHER',
      note: '  Synthetic  ',
    }).note,
  ).toBe('Synthetic');
});
const limits = [
  { from: '2026-01-01', to: '2026-03-30', days: 89 },
  { from: '2026-01-01', to: '2026-03-31', days: 90 },
  { from: '2026-01-01', to: '2026-04-01', days: 91 },
  { from: '2026-09-01', to: '2026-11-28', days: 89 },
  { from: '2026-09-01', to: '2026-11-29', days: 90 },
  { from: '2026-09-01', to: '2026-11-30', days: 91 },
  { from: '2028-01-01', to: '2028-03-29', days: 89 },
  { from: '2028-01-01', to: '2028-03-30', days: 90 },
  { from: '2028-01-01', to: '2028-03-31', days: 91 },
];
it.each(limits)(
  'validates $days inclusive dates on both creation contracts',
  ({ from, to, days }) => {
    for (const schema of [requestLeaveInput, requestEmployeeLeaveInput]) {
      const branch =
        schema === requestEmployeeLeaveInput
          ? { branch_id: '01920000-0000-7000-8000-000000000001' }
          : {};
      const result = schema.safeParse({ ...full, from, to, ...branch });
      expect(result.success).toBe(days <= 90);
      if (!result.success)
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({ path: ['to'], message: 'LEAVE_SPAN_TOO_LONG' }),
        );
    }
  },
);
it.each(Array.from({ length: 60 }, (_, minute) => minute))(
  'checks minute %i at each endpoint on both contracts',
  (minute) => {
    for (const schema of [requestLeaveInput, requestEmployeeLeaveInput]) {
      const branch =
        schema === requestEmployeeLeaveInput
          ? { branch_id: '01920000-0000-7000-8000-000000000001' }
          : {};
      for (const endpoint of ['start', 'end']) {
        const input = {
          kind: 'PARTIAL',
          date: full.from,
          type: 'ANNUAL',
          start: '09:00',
          end: '11:00',
          ...branch,
          [endpoint]: `${endpoint === 'start' ? '09' : '10'}:${String(minute).padStart(2, '0')}`,
        };
        const result = schema.safeParse(input);
        expect(result.success).toBe(minute % 15 === 0);
        if (!result.success)
          expect(result.error.issues).toContainEqual(
            expect.objectContaining({ path: [endpoint], message: 'LEAVE_TIME_STEP_INVALID' }),
          );
      }
    }
  },
);
it('preserves historical arbitrary-minute response fields', () => {
  expect(leaveRequest.shape.start.parse('09:07')).toBe('09:07');
  expect(leaveRequest.shape.end.parse('10:21')).toBe('10:21');
});
it.each([
  { ...full, employee_id: 'x' },
  { ...full, branch_id: 'x' },
  { ...full, from: '2026-02-30' },
  { ...full, type: 'OTHER' },
  { ...full, note: ' ' },
  { ...full, start: '09:00' },
])('rejects untrusted/invalid shape %#', (input) =>
  expect(requestLeaveInput.safeParse(input).success).toBe(false),
);
it('requires admin branch and cancellation revision', () => {
  expect(requestEmployeeLeaveInput.safeParse(full).success).toBe(false);
  expect(
    requestEmployeeLeaveInput.safeParse({
      ...full,
      branch_id: '01920000-0000-7000-8000-000000000001',
    }).success,
  ).toBe(true);
  expect(cancelLeaveInput.safeParse({ expected_revision: 0 }).success).toBe(false);
  expect(cancelLeaveInput.safeParse({ expected_revision: 1, status: 'APPROVED' }).success).toBe(
    false,
  );
});
