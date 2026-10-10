import { afterAll, beforeAll, expect, it } from 'vitest';
import type { TenantWrappers } from '@pospay/db';
import {
  attendanceFixture,
  enrolPersonal,
  prepareAttendance,
  type AttendanceFixture,
} from './clock-attendance.fixture.ts';
import { managerFor } from './unbind-passkey.fixture.ts';
import {
  coordinatedLockRace,
  lockEmployee,
  prepareLockEnrol,
} from './passkey-device-lock.fixture.ts';
import { ClockAttendance } from '../use-cases/clock-attendance/clock-attendance.ts';
import { createAttendanceTransactions } from '../persistence/attendance-transactions.ts';
import { createLockedAttendanceQrVerifier } from '../persistence/locked-attendance-qr.ts';
import { hmacAttendanceQr } from '../persistence/hmac-attendance-qr.ts';
import { installationHash } from '../persistence/attendance-device-signal.ts';
import { createUnbindPasskeyTransactions } from '../persistence/unbind-passkey-transactions.ts';
import { UnbindPasskeyUseCase } from '../use-cases/unbind-passkey/unbind-passkey.usecase.ts';

let f: AttendanceFixture;
let manager: Awaited<ReturnType<typeof managerFor>>;
beforeAll(async () => {
  f = await attendanceFixture();
  manager = await managerFor(f, 'owner', 'COMPANY', f.companyId);
});
afterAll(async () => {
  await f?.close();
});

function clockWith(database: TenantWrappers) {
  const qr = createLockedAttendanceQrVerifier(
    { read: async () => f.redis.get('synthetic'), getOrCreate: async () => 'ab'.repeat(32) },
    hmacAttendanceQr,
  );
  return new ClockAttendance(
    createAttendanceTransactions(database, f.ids),
    f.auth.passkeys,
    qr,
    f.clock,
    f.ids,
    f.refusals,
  );
}

async function activeOwners(phone: string) {
  return f.owner`SELECT DISTINCT bound_by FROM employee_passkeys
    WHERE company_id=${f.companyId} AND installation_hash=${installationHash(f.companyId, phone)} AND unbound_at IS NULL`;
}

it.each(['clock', 'enrol'] as const)(
  'legacy attach versus enrol: %s holds the installation first',
  async (winner) => {
    const phone =
      winner === 'clock'
        ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const legacy = await lockEmployee(f);
    const person = await enrolPersonal(f, legacy.userId, legacy.employeeId);
    const newcomer = await lockEmployee(f);
    const enrolment = await prepareLockEnrol(f, newcomer, phone);
    const prepared = await prepareAttendance(
      f,
      person.scope,
      person.device,
      f.challenge,
      f.attendance,
      f.scan(),
      true,
      phone,
    );
    const clock = (database: TenantWrappers = f.database) =>
      clockWith(database).execute(person.scope, prepared.input, prepared.idem);
    const [first, second] =
      winner === 'clock'
        ? await coordinatedLockRace(f, clock, () => enrolment.execute())
        : await coordinatedLockRace(
            f,
            (database) => enrolment.execute(database),
            () => clock(),
          );
    expect(first).toMatchObject({ status: 'fulfilled' });
    expect(second).toMatchObject({
      status: 'rejected',
      reason: {
        code: winner === 'clock' ? 'PASSKEY_DEVICE_TAKEN' : 'ATTENDANCE_DEVICE_LOCKED',
      },
    });
    expect(await activeOwners(phone)).toEqual([
      { bound_by: winner === 'clock' ? legacy.userId : newcomer.userId },
    ]);
    const loserId = winner === 'clock' ? newcomer.employeeId : legacy.employeeId;
    expect(
      await f.owner`SELECT step,reason,holder_employee_id FROM attendance_device_refusals WHERE employee_id=${loserId}`,
    ).toEqual([
      {
        step: winner === 'clock' ? 'ENROL' : 'CLOCK',
        reason: winner === 'clock' ? 'DEVICE_TAKEN' : 'DEVICE_LOCKED',
        holder_employee_id: winner === 'clock' ? legacy.employeeId : newcomer.employeeId,
      },
    ]);
  },
);

it.each(['unbind', 'enrol'] as const)(
  'installation-bearing enrol versus unbind: %s locks the employee first',
  async (winner) => {
    const phone =
      winner === 'unbind'
        ? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
        : 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const person = await lockEmployee(f);
    const original = await (await prepareLockEnrol(f, person, phone)).execute();
    const pending = await prepareLockEnrol(f, person, phone);
    const unbind = (database: TenantWrappers = f.database) =>
      new UnbindPasskeyUseCase(
        createUnbindPasskeyTransactions(database, f.ids, { now: () => new Date() }),
      ).execute(
        { ...person, userId: manager.userId },
        {
          binding_id: original.binding_id,
          revision: original.revision,
          reason: 'Synthetic concurrent release',
        },
      );
    const results =
      winner === 'unbind'
        ? await coordinatedLockRace(f, unbind, () => pending.execute())
        : await coordinatedLockRace(
            f,
            (database) => pending.execute(database),
            () => unbind(),
          );
    expect(results[1]).toMatchObject({ status: 'fulfilled' });
    if (winner === 'unbind') {
      expect(results[0]).toMatchObject({ status: 'fulfilled' });
    } else {
      expect(results[0]).toMatchObject({
        status: 'rejected',
        reason: { code: 'PASSKEY_ALREADY_BOUND' },
      });
      expect(await activeOwners(phone)).toEqual([]);
      await expect((await prepareLockEnrol(f, person, phone)).execute()).resolves.toMatchObject({
        bound: true,
      });
    }
    expect(await activeOwners(phone)).toEqual([{ bound_by: person.userId }]);
    expect(
      await f.owner`SELECT id FROM employee_passkeys WHERE employee_id=${person.employeeId} AND unbound_at IS NULL`,
    ).toHaveLength(1);
    await expect(unbind()).rejects.toMatchObject({ code: 'PASSKEY_REVISION_CONFLICT' });
  },
);
