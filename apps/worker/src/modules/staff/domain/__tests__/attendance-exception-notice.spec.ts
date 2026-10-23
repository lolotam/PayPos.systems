import { expect, it } from 'vitest';
import {
  attendanceExceptionParameters,
  formatLocalDate,
} from '../attendance-exception-notice.ts';

const KUWAIT = 'Asia/Kuwait';

it('reads the local date and time of the clock-in in the session timezone', () => {
  const clockIn = new Date('2026-10-23T06:02:00Z');
  expect(formatLocalDate(clockIn, KUWAIT)).toBe('2026-10-23');
  const parameters = attendanceExceptionParameters(
    'سارة',
    'Sara',
    'السالمية',
    'Salmiya',
    clockIn,
    KUWAIT,
  );
  expect(parameters).toEqual([
    { name: 'employee_name_ar', type: 'text', value: 'سارة' },
    { name: 'employee_name_en', type: 'text', value: 'Sara' },
    { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'clock_in_date', type: 'text', value: '2026-10-23' },
    { name: 'clock_in_time', type: 'text', value: '09:02' },
  ]);
});

it('moves a late UTC clock-in to the next local day in Kuwait', () => {
  const clockIn = new Date('2026-10-23T22:30:00Z');
  expect(formatLocalDate(clockIn, KUWAIT)).toBe('2026-10-24');
  const parameters = attendanceExceptionParameters(null, 'Sara', null, 'Salmiya', clockIn, KUWAIT);
  expect(parameters?.at(-2)).toEqual({ name: 'clock_in_date', type: 'text', value: '2026-10-24' });
  expect(parameters?.at(-1)).toEqual({ name: 'clock_in_time', type: 'text', value: '01:30' });
});

it('falls back to the English name when the Arabic one is a link or a phone', () => {
  const clockIn = new Date('2026-10-23T06:02:00Z');
  const parameters = attendanceExceptionParameters(
    'https://example.test/sara',
    'Sara',
    '+96500000001',
    'Salmiya',
    clockIn,
    KUWAIT,
  );
  expect(parameters?.[0]).toEqual({ name: 'employee_name_ar', type: 'text', value: 'Sara' });
  expect(parameters?.[2]).toEqual({ name: 'branch_name_ar', type: 'text', value: 'Salmiya' });
});

it('falls back to the English name when the Arabic one is empty', () => {
  const clockIn = new Date('2026-10-23T06:02:00Z');
  const parameters = attendanceExceptionParameters('   ', 'Sara', null, 'Salmiya', clockIn, KUWAIT);
  expect(parameters?.[0]).toEqual({ name: 'employee_name_ar', type: 'text', value: 'Sara' });
});

it('gives the generic names when no name is accepted', () => {
  const clockIn = new Date('2026-10-23T06:02:00Z');
  const parameters = attendanceExceptionParameters(null, '123456', null, '123456', clockIn, KUWAIT);
  expect(parameters?.[0]).toEqual({ name: 'employee_name_ar', type: 'text', value: 'Employee' });
  expect(parameters?.[1]).toEqual({ name: 'employee_name_en', type: 'text', value: 'Employee' });
  expect(parameters?.[2]).toEqual({ name: 'branch_name_ar', type: 'text', value: 'Branch' });
});

it('gives no parameters for a broken timezone instead of failing the job', () => {
  const clockIn = new Date('2026-10-23T06:02:00Z');
  expect(
    attendanceExceptionParameters(null, 'Sara', null, 'Salmiya', clockIn, 'Not/AZone'),
  ).toBeNull();
});
