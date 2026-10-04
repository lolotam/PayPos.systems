import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { systemClock } from '../../../shared/adapters/system-clock.ts';
import { createPersonalEligibility } from '../persistence/personal-employee.ts';
import { createPasskeyTransactions } from '../persistence/passkey-transactions.ts';
import { attendanceFixture, type AttendanceFixture } from './clock-attendance.fixture.ts';

let f: AttendanceFixture;
let branchId: string;
beforeAll(async () => {
  f = await attendanceFixture();
  branchId = f.ids.newId();
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en,timezone)
    VALUES(${f.companyId},${branchId},${f.businessId},'Synthetic midnight branch','Asia/Kuwait')`;
  await f.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${f.employeeId},${branchId},'2026-10-05','2026-10-06')`;
  await f.owner`UPDATE memberships SET scope_id=${branchId},starts_at='2026-01-01T00:00:00Z'
    WHERE company_id=${f.companyId} AND id=${f.membershipId}`;
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await f?.close();
});

it.each([
  ['2026-10-04T20:59:59.999Z', 401],
  ['2026-10-04T21:00:00.000Z', 200],
  ['2026-10-04T21:30:00.000Z', 200],
  ['2026-10-05T20:59:59.999Z', 200],
  ['2026-10-05T21:00:00.000Z', 401],
] as const)(
  'non-primary attachment at %s uses its branch date (HTTP %i)',
  async (instant, status) => {
    const now = new Date(instant);
    const clock = { now: () => now };
    vi.spyOn(systemClock, 'now').mockImplementation(clock.now);
    f.setNow(now);
    const response = await f.app.inject({
      method: 'POST',
      url: '/v1/staff/attendance/challenge',
      headers: f.headers,
      payload: f.scan(branchId),
    });
    expect(response.statusCode).toBe(status);
    const urls = [
      '/v1/staff/personal-session',
      '/v1/staff/passkey',
      `/v1/staff/my-schedule?week_start=2026-10-03&branch_id=${branchId}`,
      `/v1/staff/me/leave-requests?branch_id=${branchId}`,
    ];
    for (const url of urls) {
      const read = await f.app.inject({ method: 'GET', url, headers: f.headers });
      expect(read.statusCode, url).toBe(status);
    }
    const eligible = createPersonalEligibility(f.database, clock);
    expect(await eligible.eligible(f.userId, f.scope)).toBe(status === 200);
    const locked = createPasskeyTransactions(f.database, f.ids, clock).run(
      f.scope,
      async () => true,
    );
    if (status === 200) await expect(locked).resolves.toBe(true);
    else await expect(locked).rejects.toMatchObject({ code: 'FORBIDDEN' });
  },
);
it('an unknown branch-local date fails closed despite a live covering membership', async () => {
  vi.spyOn(systemClock, 'now').mockReturnValue(new Date(NaN));
  const response = await f.app.inject({
    method: 'GET',
    url: '/v1/staff/personal-session',
    headers: f.headers,
  });
  expect(response.statusCode).toBe(401);
  const clock = { now: () => new Date(NaN) };
  expect(await createPersonalEligibility(f.database, clock).eligible(f.userId, f.scope)).toBe(
    false,
  );
  await expect(
    createPasskeyTransactions(f.database, f.ids, clock).run(f.scope, async () => true),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
