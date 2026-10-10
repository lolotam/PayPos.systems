import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  attendanceFixture,
  enrolPersonal,
  prepareAttendance,
  type AttendanceFixture,
} from './clock-attendance.fixture.ts';
import { lockEmployee, lockEffects, PHONE_X, PHONE_Y } from './passkey-device-lock.fixture.ts';
import { installationHash } from '../persistence/attendance-device-signal.ts';
import { ClockAttendance } from '../use-cases/clock-attendance/clock-attendance.ts';
import { createAttendanceDeviceRefusals } from '../persistence/attendance-device-refusals.ts';
import type { TenantWrappers } from '@pospay/db';

let f: AttendanceFixture;
beforeAll(async () => {
  f = await attendanceFixture();
});
afterAll(async () => {
  await f?.close();
});

it('DL-02/10 attaches a legacy binding only on an accepted clock and replays across installations', async () => {
  await f.challenge.execute(f.scope, { ...f.scan(), installation_id: PHONE_X });
  expect(
    (await f.owner`SELECT installation_hash FROM employee_passkeys WHERE id=${f.bindingId}`)[0]
      ?.installation_hash,
  ).toBeNull();
  const prepared = await f.prepare();
  const result = await prepared.execute();
  expect(
    (await f.owner`SELECT installation_hash FROM employee_passkeys WHERE id=${f.bindingId}`)[0]
      ?.installation_hash,
  ).toBe(installationHash(f.companyId, PHONE_X));
  expect(
    await f.attendance.execute(
      f.scope,
      { ...prepared.input, installation_id: PHONE_Y },
      prepared.idem,
    ),
  ).toEqual(result);
  expect(await (await f.prepare()).execute()).toEqual(result);
  expect(
    await f.owner`SELECT id FROM attendance_device_signals WHERE employee_id=${f.employeeId}`,
  ).toHaveLength(1);
});

it('DL-01/03/04 refuses before consuming the assertion and rolls back all clock effects', async () => {
  const scope = await lockEmployee(f);
  const colleague = await enrolPersonal(f, scope.userId, scope.employeeId);
  const prepared = await prepareAttendance(
    f,
    colleague.scope,
    colleague.device,
    f.challenge,
    f.attendance,
    f.scan(),
    true,
    PHONE_X,
  );
  const before = await lockEffects(f, scope.employeeId);
  const ceremonies = await f.owner`SELECT id FROM attendance_clock_challenges`;
  await expect(
    f.challenge.execute(colleague.scope, { ...f.scan(), installation_id: PHONE_X }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_DEVICE_LOCKED' });
  expect(await f.owner`SELECT id FROM attendance_clock_challenges`).toHaveLength(ceremonies.length);
  await expect(prepared.execute()).rejects.toMatchObject({ code: 'ATTENDANCE_DEVICE_LOCKED' });
  expect(await lockEffects(f, scope.employeeId)).toEqual(before);
  expect(
    await f.attendance.execute(
      colleague.scope,
      { ...prepared.input, installation_id: PHONE_Y },
      prepared.idem,
    ),
  ).toMatchObject({ operation: 'CLOCK_IN' });
  await expect(
    f.challenge.execute(f.scope, { ...f.scan(), installation_id: PHONE_Y }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_DEVICE_LOCKED' });
  const freePhone = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await expect(
    f.challenge.execute(f.scope, { ...f.scan(), installation_id: freePhone }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_DEVICE_NOT_ENROLLED' });
  const refused =
    await f.owner`SELECT step,reason,holder_employee_id,branch_id FROM attendance_device_refusals WHERE employee_id=${scope.employeeId} ORDER BY attempted_at,id`;
  expect(refused).toEqual(
    ['CHALLENGE', 'CLOCK'].map((step) => ({
      step,
      reason: 'DEVICE_LOCKED',
      holder_employee_id: f.employeeId,
      branch_id: f.branchId,
    })),
  );
  expect(
    await f.owner`SELECT step,reason,holder_employee_id,branch_id FROM attendance_device_refusals WHERE employee_id=${f.employeeId} AND reason='NOT_ENROLLED'`,
  ).toEqual([
    { step: 'CHALLENGE', reason: 'NOT_ENROLLED', holder_employee_id: null, branch_id: f.branchId },
  ]);
});

it('DL-03 rechecks after a challenge and DL-06 serializes competing legacy attachments', async () => {
  const scopes = await Promise.all([lockEmployee(f), lockEmployee(f)]);
  const people = await Promise.all(
    scopes.map((scope) => enrolPersonal(f, scope.userId, scope.employeeId)),
  );
  const installation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const prepared = await Promise.all(
    people.map((p) =>
      prepareAttendance(
        f,
        p.scope,
        p.device,
        f.challenge,
        f.attendance,
        f.scan(),
        true,
        installation,
      ),
    ),
  );
  const results = await Promise.allSettled(prepared.map((p) => p.execute()));
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toMatchObject([
    { reason: { code: 'ATTENDANCE_DEVICE_LOCKED' } },
  ]);
  expect(
    await f.owner`SELECT id FROM employee_passkeys WHERE installation_hash=${installationHash(f.companyId, installation)}`,
  ).toHaveLength(1);
});

it('DL-13 reports writer failure without identifiers and preserves the refusal', async () => {
  const report = vi.fn();
  const broken = {
    withTenant: async () => {
      throw new Error(PHONE_Y);
    },
  } as unknown as TenantWrappers;
  const refusals = createAttendanceDeviceRefusals(broken, f.ids, report);
  const verify = vi.fn();
  const attendance = new ClockAttendance(
    f.transactions,
    { ...f.auth.passkeys, verifyAttendance: verify },
    { verify: async () => true },
    f.clock,
    f.ids,
    refusals,
  );
  const prepared = await f.prepare(f.scan(), true, PHONE_Y);
  await expect(attendance.execute(f.scope, prepared.input, prepared.idem)).rejects.toMatchObject({
    code: 'ATTENDANCE_DEVICE_LOCKED',
  });
  expect(verify).not.toHaveBeenCalled();
  expect(report).toHaveBeenCalledWith(f.companyId, f.employeeId);
  expect(JSON.stringify(report.mock.calls)).not.toContain(PHONE_Y);
});

it('an accepted duplicate does not attach a legacy binding', async () => {
  const scope = await lockEmployee(f);
  const person = await enrolPersonal(f, scope.userId, scope.employeeId);
  const result = {
    operation: 'CLOCK_IN',
    session_id: f.ids.newId(),
    accepted_at: f.clock.now().toISOString(),
    working_date: '2026-10-10',
    exceptions: [],
    late_minutes: 0,
    missed_session_id: null,
  };
  await f.owner`UPDATE attendance_states SET last_accepted_scan_at=${f.clock.now()},last_result=${f.owner.json(result)} WHERE employee_id=${scope.employeeId}`;
  const prepared = await prepareAttendance(
    f,
    person.scope,
    person.device,
    f.challenge,
    f.attendance,
    f.scan(),
    true,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  );
  expect(await prepared.execute()).toEqual(result);
  expect(
    (await f.owner`SELECT installation_hash FROM employee_passkeys WHERE id=${person.bindingId}`)[0]
      ?.installation_hash,
  ).toBeNull();
  expect(
    await f.owner`SELECT id FROM attendance_device_signals WHERE employee_id=${scope.employeeId}`,
  ).toHaveLength(0);
});

it('HTTP challenge and clock preserve the device refusal envelope', async () => {
  const challenge = await f.app.inject({
    method: 'POST',
    url: '/v1/staff/attendance/challenge',
    headers: f.headers,
    payload: { ...f.scan(), installation_id: PHONE_Y },
  });
  expect(challenge.statusCode).toBe(403);
  expect(challenge.json()).toMatchObject({ code: 'ATTENDANCE_DEVICE_LOCKED' });
  const prepared = await f.prepare(f.scan(), true, PHONE_Y);
  const clock = await f.app.inject({
    method: 'POST',
    url: '/v1/staff/attendance/clock',
    headers: { ...f.headers, 'idempotency-key': prepared.idem.key },
    payload: prepared.input,
  });
  expect(clock.statusCode).toBe(403);
  expect(clock.json()).toMatchObject({ code: 'ATTENDANCE_DEVICE_LOCKED' });
});
