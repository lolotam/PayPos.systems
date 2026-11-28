import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import {
  addEmployee,
  grant,
  nextPhone,
  staffAccessFixture,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';
import { paired, origin } from '../../../../test/staff-otp-harness.ts';
import { createStaffPinTransactions } from '../persistence/staff-pin-transactions.ts';
import { createRedisPinAttempts } from '../persistence/redis-pin-attempts.ts';
import { createRedisDevicePinCap } from '../persistence/redis-device-pin-cap.ts';
import { authPinHasher } from '../persistence/auth-pin-hasher.ts';
import { VerifyDiscountApproverPin } from '../use-cases/verify-discount-approver-pin/verify-discount-approver-pin.ts';
import { createStaffEligibility } from '../persistence/staff-eligibility.ts';
import { readAttendanceDeviceAccess } from '../persistence/attendance-device-access.ts';
const ids = systemUuidV7();
let f: Fixture;
beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true, staffOrigin: origin });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it.each(['staff', 'reception'] as const)(
  'AC-F1-1/2 %s creates rows and usable eligibility; a temporary PIN asks for a change before it signs in (F2)',
  async (role) => {
    const employee = await addEmployee(
      f,
      'Access ' + role,
      f.salmiya,
      role === 'staff' ? 201 : 202,
    );
    const phone = nextPhone(f);
    expect((await grant(f, employee, phone, f.ownerCookie, { role })).status).toBe(200);
    const [record] = await f.h
      .owner`SELECT user_id,membership_id,state FROM employee_staff_access WHERE employee_id=${employee}`;
    expect(record).toMatchObject({
      state: 'ACTIVE',
      user_id: expect.any(String),
      membership_id: expect.any(String),
    });
    const device = await paired(f.h, f.ownerCookie, f.company, f.salmiya);
    const context = {
      companyId: f.company,
      businessId: f.business,
      branchId: f.salmiya,
      deviceId: device.id,
    };
    expect(await createStaffEligibility(f.db).eligible(record?.user_id, context)).toBe(true);
    expect(
      await f.db.withTenant(f.company, (tx) =>
        readAttendanceDeviceAccess(
          tx,
          f.company,
          record?.user_id,
          f.business,
          f.salmiya,
          new Date(),
        ),
      ),
    ).toBe(role === 'reception');
    const pin = await createStaffPinTransactions(f.db, ids).run(f.company, null, (scope) =>
      scope.find(record?.user_id),
    );
    expect(pin).toMatchObject({ temporary: true });
    const sendPin = (value: string) =>
      f.h.app.inject({
        method: 'POST',
        url: '/v1/devices/me/staff-pin/sign-in',
        headers: { authorization: `Device ${device.token}`, origin },
        payload: { phone, pin: value },
      });
    const wrong = await sendPin('4321');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe('PIN_INVALID');
    const temporary = await sendPin('1234');
    expect(temporary.statusCode).toBe(403);
    expect(temporary.json().code).toBe('PIN_CHANGE_REQUIRED');
    expect((temporary.json().details as { proof?: string }).proof).toEqual(expect.any(String));
    expect(await f.h.owner`SELECT id FROM session WHERE user_id=${record?.user_id}`).toHaveLength(
      0,
    );
    const counter = `pin:${f.company}:staff-user:${record?.user_id}:failures`;
    // الرقم اتقبل، فالعدّاد اتصفّر: الردّ مش رفض، هو طلب تغيير.
    expect(await f.h.redis.get(counter)).toBeNull();
  },
);

it('P1-8 discount approval compares the stored temporary PIN and charges the same user counter as wrong PINs', async () => {
  const employee = await addEmployee(f, 'Approver temporary', f.salmiya, 203);
  const phone = nextPhone(f);
  expect((await grant(f, employee, phone)).status).toBe(200);
  const [record] = await f.h
    .owner`SELECT user_id FROM employee_staff_access WHERE employee_id=${employee}`;
  const db = createStaffPinTransactions(f.db, ids);
  const attempts = createRedisPinAttempts(f.h.redis, ids);
  const reserve = vi.spyOn(attempts, 'reserve');
  const verify = vi.spyOn(authPinHasher, 'verify');
  const device = { companyId: f.company, branchId: f.salmiya, deviceId: ids.newId() };
  const useCase = new VerifyDiscountApproverPin(
    db,
    authPinHasher,
    attempts,
    f.h.auth.staff,
    createRedisDevicePinCap(f.h.redis, ids),
    { valid: async () => true },
    { acquire: () => () => undefined },
  );
  expect(await useCase.execute({ phone, pin: '4321', device })).toEqual({ kind: 'refused' });
  expect(await useCase.execute({ phone, pin: '1234', device })).toEqual({ kind: 'refused' });
  const stored = await db.run(f.company, null, (scope) => scope.find(record?.user_id));
  expect(verify).toHaveBeenLastCalledWith('1234', stored?.hash);
  expect(reserve.mock.calls.map(([target]) => target.employeeId)).toEqual([
    `staff-user:${record?.user_id}`,
    `staff-user:${record?.user_id}`,
  ]);
  expect(await f.h.redis.get(`pin:${f.company}:staff-user:${record?.user_id}:failures`)).toBe('2');
  vi.restoreAllMocks();
});
