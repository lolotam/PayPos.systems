import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceFixture, type AttendanceFixture } from './clock-attendance.fixture.ts';
import { managerFor } from './unbind-passkey.fixture.ts';
import {
  lockEmployee,
  lockEffects,
  prepareLockEnrol,
  PHONE_X,
  PHONE_Y,
} from './passkey-device-lock.fixture.ts';
import { installationHash } from '../persistence/attendance-device-signal.ts';
import { createUnbindPasskeyTransactions } from '../persistence/unbind-passkey-transactions.ts';
import { UnbindPasskeyUseCase } from '../use-cases/unbind-passkey/unbind-passkey.usecase.ts';

let f: AttendanceFixture;
beforeAll(async () => {
  f = await attendanceFixture();
  await f.owner`UPDATE employee_passkeys SET installation_hash=${installationHash(f.companyId, PHONE_X)},installation_locked_at=bound_at WHERE id=${f.bindingId}`;
});
afterAll(async () => {
  await f?.close();
});

it('DL-04 CLOCK refuses a free phone without effects or consuming the assertion', async () => {
  const prepared = await f.prepare(f.scan(), true, PHONE_Y);
  const before = await lockEffects(f, f.employeeId);
  expect(before).toMatchObject({ sessions: 0, signals: 0, idempotency: 0 });
  const response = await f.app.inject({
    method: 'POST',
    url: '/v1/staff/attendance/clock',
    headers: { ...f.headers, 'idempotency-key': prepared.idem.key },
    payload: prepared.input,
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toMatchObject({ code: 'ATTENDANCE_DEVICE_NOT_ENROLLED' });
  expect(await lockEffects(f, f.employeeId)).toEqual(before);
  expect(
    await f.owner`SELECT step,reason,holder_employee_id FROM attendance_device_refusals`,
  ).toEqual([{ step: 'CLOCK', reason: 'NOT_ENROLLED', holder_employee_id: null }]);
  const retry = await f.app.inject({
    method: 'POST',
    url: '/v1/staff/attendance/clock',
    headers: { ...f.headers, 'idempotency-key': prepared.idem.key },
    payload: { ...prepared.input, installation_id: PHONE_X },
  });
  expect(retry.statusCode).toBe(200);
  expect(retry.json()).toMatchObject({ operation: 'CLOCK_IN' });
  expect(await f.owner`SELECT id FROM attendance_device_refusals`).toHaveLength(1);
});

it('relinking an employee never transfers the immutable enrolling person’s phone lock', async () => {
  const second = await lockEmployee(f, true, true);
  const secondBinding = await (await prepareLockEnrol(f, second, PHONE_X)).execute();
  const personB = await lockEmployee(f);
  await f.owner`UPDATE employees SET user_id=${personB.userId} WHERE company_id=${f.companyId} AND id=${second.employeeId}`;
  const refusals = await f.owner`SELECT id FROM attendance_device_refusals`;
  await expect(
    f.challenge.execute(f.scope, { ...f.scan(), installation_id: PHONE_X }),
  ).resolves.toBeDefined();
  await expect((await f.prepare()).execute()).resolves.toMatchObject({ operation: 'CLOCK_IN' });
  expect(await f.owner`SELECT id FROM attendance_device_refusals`).toHaveLength(refusals.length);
  const manager = await managerFor(f, 'owner', 'COMPANY', f.companyId);
  const unbind = new UnbindPasskeyUseCase(
    createUnbindPasskeyTransactions(f.database, f.ids, { now: () => new Date() }),
  );
  await unbind.execute(
    { ...f.scope, userId: manager.userId },
    {
      binding_id: f.bindingId,
      revision: 1,
      reason: 'Synthetic original record release',
    },
  );
  // يبقى ربط السجل المعاد وصله وحده؛ فلا يخفي الربط الأول خطأ نقل ملكية الهاتف.
  await expect((await prepareLockEnrol(f, personB, PHONE_X)).execute()).rejects.toMatchObject({
    code: 'PASSKEY_DEVICE_TAKEN',
  });
  expect(
    await f.owner`SELECT step,reason,holder_employee_id FROM attendance_device_refusals WHERE employee_id=${personB.employeeId}`,
  ).toEqual([{ step: 'ENROL', reason: 'DEVICE_TAKEN', holder_employee_id: second.employeeId }]);
  await unbind.execute(
    { ...second, userId: manager.userId },
    {
      binding_id: secondBinding.binding_id,
      revision: secondBinding.revision,
      reason: 'Synthetic relinked record release',
    },
  );
  await expect((await prepareLockEnrol(f, personB, PHONE_X)).execute()).resolves.toMatchObject({
    bound: true,
  });
});
