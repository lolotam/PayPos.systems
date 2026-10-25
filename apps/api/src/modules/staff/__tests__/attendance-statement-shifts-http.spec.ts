import { attendanceStatementShiftOptions } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  attendanceStatementHttpFixture,
  type AttendanceStatementHttpFixture,
} from './attendance-statement-http.fixture.ts';
import {
  seedStatementEmployee,
  seedStatementShift,
} from './attendance-statement-http-seed.fixture.ts';

let f: AttendanceStatementHttpFixture;
beforeAll(async () => {
  f = await attendanceStatementHttpFixture();
  for (const shift of [
    { workingDate: '2026-10-05', start: '09:00', end: '17:00' },
    { workingDate: '2026-10-12', start: '09:00', end: '17:00' },
    { workingDate: '2026-10-07', start: '22:00', end: '06:00', endsOn: '2026-10-08' },
    { workingDate: '2026-10-05', start: '20:00', end: '23:00', branchId: f.sameBusinessBranch },
    { workingDate: '2026-11-02', start: '07:00', end: '15:00' },
  ]) {
    const employee = await seedStatementEmployee(f, {
      name: `Synthetic shift ${shift.workingDate} ${shift.start}`,
    });
    await seedStatementShift(f, employee, shift);
  }
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function shifts(from = '2026-10-01', to = '2026-10-31', cookie?: string, branchId?: string) {
  return f.h.send(
    'GET',
    `/v1/businesses/${f.business}/branches/${branchId ?? f.branch}/attendance-statement-shifts?from=${from}&to=${to}`,
    { cookie: cookie ?? f.cookie, company: f.company },
  );
}

it('lists ordered distinct local pairs, including overnight shifts, in this branch and period only', async () => {
  const response = await shifts();
  expect(response.status).toBe(200);
  expect(attendanceStatementShiftOptions.parse(response.body)).toEqual({
    shifts: [
      { start: '09:00', end: '17:00' },
      { start: '22:00', end: '06:00' },
    ],
  });
});

it('returns an empty list for a period with no shifts', async () => {
  const response = await shifts('2026-12-01', '2026-12-31');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ shifts: [] });
});

it.each([
  ['2026-10-31', '2026-10-01'],
  ['2025-10-30', '2026-10-31'],
])('refuses invalid range %s to %s', async (from, to) => {
  expect((await shifts(from, to)).status).toBe(400);
});

it('refuses another business branch and a caller without permission', async () => {
  const mismatch = await shifts(undefined, undefined, undefined, f.otherBranch);
  expect(mismatch.status).toBe(404);
  expect(mismatch.body).toMatchObject({ code: 'ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND' });
  expect((await shifts(undefined, undefined, f.readerCookie)).status).toBe(403);
});
