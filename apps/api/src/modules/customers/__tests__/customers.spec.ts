import { Writable } from 'node:stream';

import { customer } from '@pospay/contracts';
import { createDatabase } from '@pospay/db';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { createCustomerTransactions } from '../persistence/drizzle-customer-transactions.ts';
import { FindOrCreateCustomerUseCase } from '../use-cases/find-or-create-customer/find-or-create-customer.usecase.ts';

const PATH = '/v1/customers/find-or-create';
const PHONE = '+12025550123';
const phoneInput = (national_number: string, calling_code = '1') => ({
  calling_code,
  national_number,
});
const payload = { phone: phoneInput('2025550123'), name: 'Example A', locale: 'ar' };
let h: Harness;
let cookieA: string;
let cookieB: string;
let A: string;
let B: string;
let userA: string;
let idA: string;
let logs = '';

beforeAll(async () => {
  h = await startHarness({
    logs: new Writable({
      write(chunk, _encoding, done) {
        logs += String(chunk);
        done();
      },
    }),
  });
  cookieA = await h.signedInOperator('customers-a@example.test');
  cookieB = await h.signedInOperator('customers-b@example.test');
  A = await h.onboard(cookieA, 'Customer Company A');
  B = await h.onboard(cookieB, 'Customer Company B');
  const [row] = await h.owner`SELECT user_id FROM memberships WHERE company_id = ${A}`;
  userA = row?.['user_id'] as string;
});

afterAll(async () => {
  await h.close();
});

async function grant(companyId: string) {
  await h.owner`INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect, scope_type, scope_id, reason, granted_by)
    SELECT company_id, id, id, 'create:customers:company', 'ALLOW', 'COMPANY', company_id, 'Synthetic test grant', user_id
    FROM memberships WHERE company_id = ${companyId}`;
}

const send = (phone: unknown = payload.phone, extra: object = {}) =>
  h.send('POST', PATH, {
    cookie: cookieA,
    company: A,
    body: { ...payload, phone, ...extra },
  });

it('CUS-08 catalog grants no role; missing permission and session are refused', async () => {
  expect(
    await h.owner`SELECT 1 FROM role_permissions WHERE permission_code = 'create:customers:company'`,
  ).toHaveLength(0);
  expect((await send()).status).toBe(403);
  expect((await h.app.inject({ method: 'POST', url: PATH, payload })).statusCode).toBe(401);
  expect(await h.owner`SELECT 1 FROM customers`).toHaveLength(0);
  await grant(A);
  await grant(B);
});

it('CUS-01 creates with a UUID v7 and one privacy-safe audit, without outbox', async () => {
  const result = await send();
  expect(result.status).toBe(200);
  const body = customer.parse(result.body);
  idA = body.id;
  expect(body).toMatchObject({
    name: 'Example A',
    locale: 'ar',
    opted_out: false,
    phone: '***123',
  });
  expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  expect(result.text).not.toContain(PHONE);
  const audit =
    await h.owner`SELECT actor_user_id, action, after FROM audit_log WHERE company_id = ${A} AND entity_id = ${idA}`;
  expect(audit).toEqual([{ actor_user_id: userA, action: 'created', after: body }]);
  expect(await h.owner`SELECT 1 FROM outbox WHERE aggregate_id = ${idA}`).toHaveLength(0);
});

it('CUS-02 returns the existing identity without overwriting name, locale or timestamps', async () => {
  const before =
    await h.owner`SELECT name, locale, created_at, updated_at FROM customers WHERE company_id = ${A} AND id = ${idA}`;
  const result = await send(phoneInput('0002025550123'), {
    name: 'Do not overwrite',
    locale: 'en',
  });
  expect(result.status).toBe(200);
  expect(customer.parse(result.body)).toMatchObject({ id: idA, name: 'Example A', locale: 'ar' });
  expect(
    await h.owner`SELECT name, locale, created_at, updated_at FROM customers WHERE company_id = ${A} AND id = ${idA}`,
  ).toEqual(before);
  expect(
    await h.owner`SELECT 1 FROM audit_log WHERE company_id = ${A} AND entity_id = ${idA}`,
  ).toHaveLength(1);
});

it('CUS-03 simultaneous callers receive one id, row and creation audit', async () => {
  const phone = '+12025550124';
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      send(phoneInput(`${'0'.repeat(i)}2025550124`), {
        name: `Concurrent ${i}`,
        locale: i % 2 ? 'en' : 'ar',
      }),
    ),
  );
  expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
  const bodies = results.map((r) => customer.parse(r.body));
  expect(new Set(bodies.map((b) => b.id)).size).toBe(1);
  expect(new Set(bodies.map((b) => b.name)).size).toBe(1);
  expect(new Set(bodies.map((b) => b.locale)).size).toBe(1);
  expect(
    await h.owner`SELECT 1 FROM customers WHERE company_id = ${A} AND phone = ${phone}`,
  ).toHaveLength(1);
  expect(
    await h.owner`SELECT 1 FROM audit_log WHERE company_id = ${A} AND entity_id = ${bodies[0]?.id ?? ''}`,
  ).toHaveLength(1);
});

it('CUS-04 same phone in B is a separate customer; A cannot resolve B', async () => {
  const result = await h.send('POST', PATH, {
    cookie: cookieB,
    company: B,
    body: { ...payload, name: 'Example B', locale: 'en' },
  });
  expect(result.status).toBe(200);
  const body = customer.parse(result.body);
  expect(body.id).not.toBe(idA);
  expect(body).toMatchObject({ name: 'Example B', locale: 'en' });
  const offset = h.calls.tenant.length;
  const forbidden = await h.send('POST', PATH, { cookie: cookieA, company: B, body: payload });
  expect(forbidden.status).toBe(403);
  expect(h.calls.tenant.slice(offset)).not.toContain(B);
  expect(
    await h.owner`SELECT company_id FROM customers WHERE phone = ${PHONE} ORDER BY company_id`,
  ).toHaveLength(2);
});

it.each([
  PHONE,
  phoneInput('2025550123\n'),
  phoneInput('202 5550123'),
  phoneInput('0'),
  phoneInput('2'.repeat(15)),
  phoneInput('1234567', '965'),
  phoneInput('123456789', '965'),
  phoneInput('12345678', '0965'),
])('CUS-05 rejects invalid phone by name and without echo: %j', async (phone) => {
  const result = await send(phone);
  expect(result.status).toBe(400);
  expect(result.body).toMatchObject({
    code: 'INVALID_CUSTOMER_PHONE',
    message_ar: expect.any(String),
    message_en: expect.any(String),
  });
  expect(result.body).not.toHaveProperty('details');
  expect(result.text).not.toContain(typeof phone === 'string' ? phone : phone.national_number);
});

it('CUS-08 disabled feature refuses writes and restoring it permits lookup', async () => {
  await h.owner`INSERT INTO company_feature_overrides (company_id, flag, enabled, reason, set_by)
      VALUES (${A}, 'customers', false, 'Synthetic feature test', ${userA})`;
  expect((await send()).body).toMatchObject({ code: 'FEATURE_DISABLED' });
  await h.owner`UPDATE company_feature_overrides SET enabled = true WHERE company_id = ${A} AND flag = 'customers'`;
  expect((await send()).status).toBe(200);
});

it('CUS-07 failed audit rolls back a new customer inside withTenant', async () => {
  const db = createDatabase({ url: h.urls.app, ids: { newId: () => idA } });
  const ids = { newId: () => '01920000-0000-7000-8000-00000000abcd' };
  const transactions = createCustomerTransactions(db, { newId: () => 'invalid-audit-id' });
  const useCase = new FindOrCreateCustomerUseCase(transactions, ids, {
    now: () => new Date('2026-10-01T00:00:00Z'),
  });
  try {
    await expect(
      useCase.execute({
        companyId: A,
        userId: userA,
        input: { ...payload, phone: phoneInput('2025550125'), locale: 'ar' },
      }),
    ).rejects.toThrow();
    expect(
      await h.owner`SELECT 1 FROM customers WHERE company_id = ${A} AND phone = '+12025550125'`,
    ).toHaveLength(0);
  } finally {
    await db.close();
  }
});

it('CUS-06 preserves existing opt-out and keeps phones out of responses, audit and logs', async () => {
  await h.owner`UPDATE customers SET opted_out_at = now() WHERE company_id = ${A} AND id = ${idA}`;
  const result = await send();
  expect(customer.parse(result.body)).toMatchObject({ opted_out: true, phone: '***123' });
  expect(result.text).not.toContain(PHONE);
  const audit = await h.owner`SELECT after FROM audit_log WHERE entity = 'customer'`;
  for (const phone of [PHONE, '+12025550124', '+12025550125', '2025550123']) {
    expect(logs).not.toContain(phone);
    expect(JSON.stringify(audit)).not.toContain(phone);
  }
  expect(logs).toContain('request completed');
});

it('normalizes Kuwait national zeros and preserves the selected country in identity', async () => {
  const first = await send(phoneInput('00012345678', '965'));
  const repeated = await send(phoneInput('12345678', '965'));
  const otherCountry = await send(phoneInput('12345678', '1'));
  expect([first.status, repeated.status, otherCountry.status]).toEqual([200, 200, 200]);
  const kuwait = customer.parse(first.body);
  expect(customer.parse(repeated.body).id).toBe(kuwait.id);
  expect(customer.parse(otherCountry.body).id).not.toBe(kuwait.id);
  expect(kuwait.phone).toBe('***678');
  expect(
    await h.owner`SELECT phone FROM customers WHERE company_id = ${A} AND id = ${kuwait.id}`,
  ).toEqual([{ phone: '+96512345678' }]);
  for (const value of ['+96512345678', '00012345678', '12345678']) {
    expect(first.text).not.toContain(value);
    expect(logs).not.toContain(value);
  }
});

it('CUS-06 sanitizes an unexpected failure that contains the input phone', async () => {
  const useCase = h.app.get(FindOrCreateCustomerUseCase);
  const execute = vi
    .spyOn(useCase, 'execute')
    .mockRejectedValueOnce(new Error(`Synthetic failure ${PHONE}`));
  try {
    const result = await send();
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(result.text).not.toContain(PHONE);
    expect(logs).not.toContain(PHONE);
  } finally {
    execute.mockRestore();
  }
});
