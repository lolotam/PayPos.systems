import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { personalOrigin } from '../../../../test/personal-staff.fixture.ts';
import { unbindFixture, requestFor, type UnbindFixture } from './unbind-passkey.fixture.ts';
import {
  lockEmployee,
  lockEffects,
  lockEnrol,
  prepareLockEnrol,
  PHONE_X,
  PHONE_Y,
} from './passkey-device-lock.fixture.ts';
import { installationHash } from '../persistence/attendance-device-signal.ts';

let f: UnbindFixture;
let first: Awaited<ReturnType<Awaited<ReturnType<typeof prepareLockEnrol>>['execute']>>;
let firstDevice: Awaited<ReturnType<typeof prepareLockEnrol>>['device'];
beforeAll(async () => {
  f = await unbindFixture();
});
afterAll(async () => {
  await f?.close();
});

it('DL-05 records enrollment locks and refuses both pre-check and verify without binding effects', async () => {
  const registration = await prepareLockEnrol(f, f.personal, PHONE_X);
  firstDevice = registration.device;
  first = await registration.execute();
  const other = await lockEmployee(f);
  const pending = await prepareLockEnrol(f, other, PHONE_X);
  const before = await lockEffects(f, other.employeeId);
  await expect(lockEnrol(f).checkInstallation(other, PHONE_X)).rejects.toMatchObject({
    code: 'PASSKEY_DEVICE_TAKEN',
  });
  await expect(pending.execute()).rejects.toMatchObject({ code: 'PASSKEY_DEVICE_TAKEN' });
  expect(await lockEffects(f, other.employeeId)).toEqual(before);
  expect(await f.owner`SELECT id FROM passkey WHERE user_id=${other.userId}`).toHaveLength(1);
  expect(
    await f.owner`SELECT step,reason,holder_employee_id,branch_id FROM attendance_device_refusals WHERE employee_id=${other.employeeId}`,
  ).toEqual(
    [1, 2].map(() => ({
      step: 'ENROL',
      reason: 'DEVICE_TAKEN',
      holder_employee_id: f.employeeId,
      branch_id: f.branchId,
    })),
  );
  const response = await requestFor(f)('GET');
  expect(response.statusCode).toBe(200);
  expect(response.json().status).toMatchObject({
    phone_locked: true,
    phone_locked_since: first.bound_at,
  });
  expect(JSON.stringify(response.json())).not.toContain('installation_hash');
});

it('DL-07/07b permits the same person in another business only on the same installation', async () => {
  const scope = await lockEmployee(f, true, true);
  await expect(lockEnrol(f).checkInstallation(scope, PHONE_Y)).rejects.toMatchObject({
    code: 'PASSKEY_OTHER_DEVICE',
  });
  await expect((await prepareLockEnrol(f, scope, PHONE_Y)).execute()).rejects.toMatchObject({
    code: 'PASSKEY_OTHER_DEVICE',
  });
  await expect(lockEnrol(f).checkInstallation(scope, PHONE_X)).resolves.toBeUndefined();
  await expect((await prepareLockEnrol(f, scope, PHONE_X)).execute()).resolves.toMatchObject({
    bound: true,
  });
  expect(
    await f.owner`SELECT id FROM employee_passkeys WHERE installation_hash=${installationHash(f.companyId, PHONE_X)}`,
  ).toHaveLength(2);
  const [binding] =
    await f.owner`SELECT id,revision FROM employee_passkeys WHERE employee_id=${scope.employeeId}`;
  await f.unbind.execute(
    { ...scope, userId: f.manager.userId },
    {
      binding_id: String(binding?.id),
      revision: Number(binding?.revision),
      reason: 'Synthetic second business release',
    },
  );
});

it('DL-06 allows exactly one of two concurrent enrollments on a new phone', async () => {
  const scopes = await Promise.all([lockEmployee(f), lockEmployee(f)]);
  const phone = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const attempts = await Promise.all(scopes.map((scope) => prepareLockEnrol(f, scope, phone)));
  const results = await Promise.allSettled(attempts.map((attempt) => attempt.execute()));
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
    { reason: { code: 'PASSKEY_DEVICE_TAKEN' } },
  ]);
  expect(
    await f.owner`SELECT id FROM employee_passkeys WHERE installation_hash=${installationHash(f.companyId, phone)}`,
  ).toHaveLength(1);
});

it('DL-08/09 unbind frees the phone and permits recovery on another phone', async () => {
  const [row] =
    await f.owner`SELECT passkey_id FROM employee_passkeys WHERE id=${first.binding_id}`;
  const scope = {
    ...f.personal,
    bindingId: first.binding_id,
    bindingRevision: first.revision,
    passkeyId: String(row?.passkey_id),
    branchId: f.branchId,
    operation: 'CLOCK_IN' as const,
    qrContext: 'synthetic',
  };
  const stale = await f.auth.passkeys.attendanceOptions(scope);
  const unbound = await f.unbind.execute(f.scope, {
    binding_id: first.binding_id,
    revision: first.revision,
    reason: 'Synthetic phone recovery',
  });
  const proof = await f.auth.passkeys.verifyAttendance(
    scope,
    stale.challengeId,
    firstDevice.assertion(stale.options.challenge, personalOrigin, 'localhost'),
  );
  expect(proof).not.toBeNull();
  expect(proof?.consume({ ...scope, bindingRevision: unbound.revision })).toBe(false);
  const other = await lockEmployee(f);
  await expect((await prepareLockEnrol(f, other, PHONE_X)).execute()).resolves.toMatchObject({
    bound: true,
  });
  await expect((await prepareLockEnrol(f, f.personal, PHONE_Y)).execute()).resolves.toMatchObject({
    bound: true,
  });
});

it('legacy enrollment keeps a NULL hash and refusal evidence never contains a raw installation', async () => {
  const scope = await lockEmployee(f);
  const binding = await (await prepareLockEnrol(f, scope)).execute();
  expect(
    (
      await f.owner`SELECT installation_hash FROM employee_passkeys WHERE id=${binding.binding_id}`
    )[0]?.installation_hash,
  ).toBeNull();
  for (const table of ['attendance_device_refusals', 'employee_passkeys', 'audit_log', 'outbox']) {
    const rows = await f.owner.unsafe(`SELECT row_to_json(t) FROM ${table} t`);
    expect(JSON.stringify(rows)).not.toContain(PHONE_X);
    expect(JSON.stringify(rows)).not.toContain(PHONE_Y);
  }
});

it('options HTTP pre-check refuses before issuing a registration ceremony', async () => {
  const scope = await lockEmployee(f, true, true);
  const issued = await f.auth.personal.issue(
    scope.userId,
    {
      purpose: 'STAFF_PERSONAL',
      companyId: scope.companyId,
      businessId: scope.businessId,
    },
    async () => true,
  );
  const options = vi.spyOn(f.auth.passkeys, 'enrollmentOptions');
  try {
    const response = await f.app.inject({
      method: 'POST',
      url: '/v1/staff/passkey/options',
      headers: { cookie: issued.cookie.split(';')[0] ?? '', origin: personalOrigin },
      payload: { installation_id: PHONE_X },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PASSKEY_DEVICE_TAKEN' });
    expect(options).not.toHaveBeenCalled();
  } finally {
    options.mockRestore();
  }
});
