import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  attendanceFixture,
  prepareAttendance,
  type AttendanceFixture,
} from './clock-attendance.fixture.ts';
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
import { attendanceDeviceLock } from '../persistence/attendance-context.adapter.ts';

let f: AttendanceFixture;
beforeAll(async () => {
  f = await attendanceFixture();
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

async function prepareRequest(
  kind: 'enrol' | 'attach',
  scope: Awaited<ReturnType<typeof lockEmployee>>,
  phone: string,
) {
  const enrolment = await prepareLockEnrol(f, scope, kind === 'enrol' ? phone : undefined);
  if (kind === 'enrol') return enrolment.execute;
  await enrolment.execute();
  const clock = await prepareAttendance(
    f,
    scope,
    enrolment.device,
    f.challenge,
    f.attendance,
    f.scan(scope.branchId),
    true,
    phone,
  );
  return (database: TenantWrappers = f.database) =>
    clockWith(database).execute(scope, clock.input, clock.idem);
}

it.each([
  ['enrol', 'enrol'],
  ['attach', 'attach'],
  ['attach', 'enrol'],
  ['enrol', 'attach'],
] as const)(
  'PL-Q4 serializes one person across businesses: %s wins over %s',
  async (winner, loser) => {
    const first = await lockEmployee(f, false, true);
    const second = await lockEmployee({ ...f, userId: first.userId }, true, true);
    const phone = randomUUID();
    const win = await prepareRequest(winner, first, phone);
    const lose = await prepareRequest(loser, second, randomUUID());
    // كلا الصفين بلا قفل قبل السباق؛ نثبت انتظار المنافس حتى تُحسم المعاملة الأولى.
    const results = await coordinatedLockRace(f, win, () => lose());
    expect(results[0]).toMatchObject({ status: 'fulfilled' });
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: {
        code: loser === 'enrol' ? 'PASSKEY_OTHER_DEVICE' : 'ATTENDANCE_DEVICE_NOT_ENROLLED',
      },
    });
    expect(
      await f.owner`SELECT DISTINCT installation_hash FROM employee_passkeys
    WHERE company_id=${f.companyId} AND bound_by=${first.userId}
      AND unbound_at IS NULL AND installation_hash IS NOT NULL`,
    ).toEqual([{ installation_hash: installationHash(f.companyId, phone) }]);
    expect(
      await f.owner`SELECT id FROM attendance_sessions WHERE employee_id=${second.employeeId}`,
    ).toEqual([]);
    expect(
      await f.owner`SELECT reason,holder_employee_id FROM attendance_device_refusals
    WHERE employee_id=${second.employeeId}`,
    ).toEqual([
      { reason: loser === 'enrol' ? 'OTHER_DEVICE' : 'NOT_ENROLLED', holder_employee_id: null },
    ]);
  },
);

it('the shared adapter serializes different phones without relying on the eligibility company lock', async () => {
  const first = await lockEmployee(f, false, true);
  const second = await lockEmployee({ ...f, userId: first.userId }, true, true);
  const binding = await (await prepareLockEnrol(f, first)).execute();
  const phone = randomUUID();
  const otherPhone = randomUUID();
  const firstRequest = (database: TenantWrappers) =>
    database.withTenant(f.companyId, async (tx) => {
      await tx.execute(
        sql`SELECT id FROM employees WHERE company_id=${f.companyId} AND id=${first.employeeId} FOR UPDATE`,
      );
      const facts = await attendanceDeviceLock(tx, first, phone, binding.binding_id);
      await tx.execute(sql`UPDATE employee_passkeys
      SET installation_hash=${installationHash(f.companyId, phone)},installation_locked_at=${f.clock.now().toISOString()}::timestamptz
      WHERE company_id=${f.companyId} AND id=${binding.binding_id}`);
      return facts;
    });
  const secondRequest = () =>
    f.database.withTenant(f.companyId, async (tx) => {
      await tx.execute(
        sql`SELECT id FROM employees WHERE company_id=${f.companyId} AND id=${second.employeeId} FOR UPDATE`,
      );
      return attendanceDeviceLock(tx, second, otherPhone, null);
    });
  const results = await coordinatedLockRace(f, firstRequest, secondRequest);
  expect(results).toMatchObject([
    { status: 'fulfilled', value: { own: 'NONE', heldByOther: null, bindingUnlocked: true } },
    { status: 'fulfilled', value: { own: 'OTHER', heldByOther: null, bindingUnlocked: true } },
  ]);
});
