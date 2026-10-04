import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { employeePasskeyHistory } from '@pospay/contracts';
import { bindingAcceptsProof } from '../domain/unbind-passkey.ts';
import { createUnbindPasskeyTransactions } from '../persistence/unbind-passkey-transactions.ts';
import { UnbindPasskeyUseCase } from '../use-cases/unbind-passkey/unbind-passkey.usecase.ts';
import {
  enrollFor,
  requestFor,
  unbindFixture,
  type UnbindFixture,
} from './unbind-passkey.fixture.ts';
import { personalOrigin } from '../../../../test/personal-staff.fixture.ts';

let f: UnbindFixture;
beforeAll(async () => {
  f = await unbindFixture();
});
afterAll(async () => {
  await f?.close();
});

it('mandatory reason and revision fence precede one atomic audited historical unbind', async () => {
  const { binding } = await enrollFor(f);
  const send = requestFor(f);
  const body = { binding_id: binding.binding_id, revision: binding.revision, reason: '   ' };
  expect((await send('POST', f.url + '/unbind', body)).statusCode).toBe(400);
  expect(
    (await send('POST', f.url + '/unbind', { ...body, reason: 'x'.repeat(501) })).statusCode,
  ).toBe(400);
  expect(
    (await send('POST', f.url + '/unbind', { ...body, revision: 99, reason: 'Changed phone' }))
      .statusCode,
  ).toBe(409);
  const result = await send('POST', f.url + '/unbind', { ...body, reason: '  Changed phone  ' });
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({ binding_id: binding.binding_id, revision: 2 });
  const [saved] = await f.owner`SELECT * FROM employee_passkeys WHERE id=${binding.binding_id}`;
  expect(saved).toMatchObject({ revision: 2, unbound_by: f.manager.userId });
  expect(saved?.['unbound_at']).toBeInstanceOf(Date);
  expect(await f.owner`SELECT id FROM passkey WHERE id=${saved?.['passkey_id']}`).toHaveLength(1);
  const audit =
    await f.owner`SELECT "after" FROM audit_log WHERE action='passkey.unbind' AND entity_id=${binding.binding_id}`;
  expect(audit).toHaveLength(1);
  expect(audit[0]?.['after']).toMatchObject({ reason: 'Changed phone', revision: 2 });
  const events =
    await f.owner`SELECT payload FROM outbox WHERE event_type='EmployeePasskeyUnbound' AND aggregate_id=${f.employeeId}`;
  expect(events).toHaveLength(1);
  expect(events[0]?.['payload']).toEqual({ employee_id: f.employeeId, ...result.json() });
  expect(JSON.stringify(events)).not.toContain('Changed phone');
  expect((await send('POST', f.url + '/unbind', { ...body, reason: 'Replay' })).statusCode).toBe(
    409,
  );
  const history = employeePasskeyHistory.parse((await send('GET')).json());
  expect(history.status.bound).toBe(false);
  expect(history.items).toHaveLength(1);
  expect(JSON.stringify(history)).not.toContain(saved?.['passkey_id']);
});

it('re-enrollment is automatic after unbind; both outstanding challenge and verified proof are fenced', async () => {
  const { device, binding } = await enrollFor(f);
  expect(binding.revision).toBe(3);
  const [row] =
    await f.owner`SELECT passkey_id FROM employee_passkeys WHERE id=${binding.binding_id}`;
  const scope = {
    ...f.personal,
    bindingId: String(binding.binding_id),
    bindingRevision: Number(binding.revision),
    passkeyId: String(row?.['passkey_id']),
    branchId: f.branchId,
    operation: 'CLOCK_IN' as const,
    qrContext: 'synthetic',
  };
  const first = await f.auth.passkeys.attendanceOptions(scope);
  const proof = await f.auth.passkeys.verifyAttendance(
    scope,
    first.challengeId,
    device.assertion(first.options.challenge, personalOrigin, 'localhost'),
  );
  expect(proof).not.toBeNull();
  const outstanding = await f.auth.passkeys.attendanceOptions(scope);
  await f.unbind.execute(f.scope, {
    binding_id: String(binding.binding_id),
    revision: Number(binding.revision),
    reason: 'Synthetic device replacement',
  });
  const [current] =
    await f.owner`SELECT id,revision,unbound_at FROM employee_passkeys WHERE id=${binding.binding_id}`;
  const currentBinding = {
    id: String(current?.['id']),
    revision: Number(current?.['revision']),
    unboundAt: new Date(String(current?.['unbound_at'])),
  };
  expect(bindingAcceptsProof(currentBinding, scope)).toBe(false);
  expect(proof?.consume({ ...scope, bindingRevision: currentBinding.revision })).toBe(false);
  // PR22 يفحص نفس الربط والنسخة تحت القفل؛ التحقق المشفر وحده لا يعيد سلطة الربط القديم.
  const old = await f.auth.passkeys.verifyAttendance(
    scope,
    outstanding.challengeId,
    device.assertion(outstanding.options.challenge, personalOrigin, 'localhost', true, 1),
  );
  expect(old).not.toBeNull();
  expect(bindingAcceptsProof(currentBinding, scope)).toBe(false);
  const next = await enrollFor(f);
  expect(next.binding.revision).toBe(5);
  const history = employeePasskeyHistory.parse((await requestFor(f)('GET')).json());
  expect(history.items).toHaveLength(3);
  expect(history.status).toMatchObject({ bound: true, revision: 5 });
});

it('rollback preserves the binding and publishes neither audit nor outbox', async () => {
  const [binding] =
    await f.owner`SELECT id,revision FROM employee_passkeys WHERE employee_id=${f.employeeId} AND unbound_at IS NULL`;
  const transactions = createUnbindPasskeyTransactions(
    {
      ...f.database,
      withTenant: (company, work, options) =>
        f.database.withTenant(
          company,
          async (tx) => {
            await work(tx);
            throw new Error('SYNTHETIC_ROLLBACK');
          },
          options,
        ),
    },
    f.ids,
  );
  const useCase = new UnbindPasskeyUseCase(transactions, { now: () => new Date() });
  const input = {
    binding_id: String(binding?.['id']),
    revision: Number(binding?.['revision']),
    reason: 'Synthetic rollback',
  };
  await expect(useCase.execute(f.scope, input)).rejects.toThrow(
    'PASSKEY_UNBIND_PERSISTENCE_FAILED',
  );
  const [saved] =
    await f.owner`SELECT revision,unbound_at FROM employee_passkeys WHERE id=${input.binding_id}`;
  expect(saved).toEqual({ revision: input.revision, unbound_at: null });
  expect(
    await f.owner`SELECT id FROM audit_log WHERE action='passkey.unbind' AND entity_id=${input.binding_id}`,
  ).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type='EmployeePasskeyUnbound' AND payload->>'binding_id'=${input.binding_id}`,
  ).toHaveLength(0);
});

it('concurrent enrolment and repeated unbind serialize without deleting global credentials', async () => {
  const [binding] =
    await f.owner`SELECT id,revision FROM employee_passkeys WHERE employee_id=${f.employeeId} AND unbound_at IS NULL`;
  const input = {
    binding_id: String(binding?.['id']),
    revision: Number(binding?.['revision']),
    reason: 'Synthetic race',
  };
  const generated = await f.auth.passkeys.enrollmentOptions(f.personal);
  const { testAuthenticator } =
    await import('../../../../../../packages/auth/src/__tests__/webauthn.fixture.ts');
  const device = testAuthenticator();
  const results = await Promise.allSettled([
    f.unbind.execute(f.scope, input),
    f.unbind.execute(f.scope, input),
    f.enrol.execute(
      f.personal,
      generated.challengeId,
      device.registration(generated.options.challenge, personalOrigin, 'localhost'),
    ),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled').length).toBeGreaterThanOrEqual(
    1,
  );
  expect(
    results
      .filter((result) => result.status === 'rejected')
      .every((result) => result.reason?.message !== 'PASSKEY_UNBIND_PERSISTENCE_FAILED'),
  ).toBe(true);
  expect(
    await f.database.withTenant(f.companyId, (tx) =>
      tx.execute(
        sql`SELECT id FROM employee_passkeys WHERE employee_id=${f.employeeId} AND unbound_at IS NULL`,
      ),
    ),
  ).toHaveLength(results[2]?.status === 'fulfilled' ? 1 : 0);
  expect(
    await f.owner`SELECT id FROM audit_log WHERE action='passkey.unbind' AND entity_id=${input.binding_id}`,
  ).toHaveLength(1);
});
