import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AttendanceTransactions } from '../ports/clock-attendance.port.ts';
import { attendanceFixture, type AttendanceFixture } from './clock-attendance.fixture.ts';
import { ClockAttendance } from '../use-cases/clock-attendance/clock-attendance.ts';
import { lockEffects } from './passkey-device-lock.fixture.ts';

let f: AttendanceFixture;
beforeAll(async () => {
  f = await attendanceFixture();
});
afterAll(async () => {
  await f?.close();
});

it('rolls back the attached hash, timestamp and audit together if the clock transaction fails', async () => {
  const prepared = await f.prepare();
  const before = await lockEffects(f, f.employeeId);
  const transactions: AttendanceTransactions = {
    run: (scope, scan, sample, work) =>
      f.transactions.run(scope, scan, sample, async (tx, at) => {
        await work(tx, at);
        throw new Error('SYNTHETIC_CLOCK_ROLLBACK');
      }),
  };
  const clock = new ClockAttendance(
    transactions,
    f.auth.passkeys,
    { verify: async () => true },
    f.clock,
    f.ids,
    f.refusals,
  );
  await expect(clock.execute(f.scope, prepared.input, prepared.idem)).rejects.toThrow(
    'SYNTHETIC_CLOCK_ROLLBACK',
  );
  expect(await lockEffects(f, f.employeeId)).toEqual(before);
  expect(
    await f.owner`SELECT installation_hash,installation_locked_at FROM employee_passkeys WHERE id=${f.bindingId}`,
  ).toEqual([{ installation_hash: null, installation_locked_at: null }]);
  expect(
    await f.owner`SELECT id FROM audit_log WHERE entity='employee_passkey' AND action='phone_locked'`,
  ).toEqual([]);
});
