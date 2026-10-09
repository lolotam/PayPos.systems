import { OWNER_ROLE_ID } from '@pospay/db';
import { GCC_BANKS } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ApiError } from '../../../shared/errors.ts';
import { ZodValidationPipe } from '../../../shared/zod-validation.pipe.ts';
import { setEmployeeIbanInput } from '@pospay/contracts';
import { createEmployeeIbanTransactions } from '../persistence/drizzle-employee-iban-transactions.ts';
import { SetEmployeeIbanUseCase } from '../use-cases/set-employee-iban/set-employee-iban.usecase.ts';
import {
  employeeIbanFixture,
  generatedIban,
  ibanHttp,
  ibanIds,
  ibanTerms,
  newIbanEmployee,
  registryIban,
  type IbanFixture,
} from './employee-iban.fixture.ts';
let f: IbanFixture;
beforeAll(async () => {
  f = await employeeIbanFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('IB-01/02/06 sets normalized data without an idempotency key; no-op writes no row or audit', async () => {
  const input = {
    ...ibanTerms(),
    iban: ' kw٨١ cbku 0000 0000 0000 1234 5601 01 ',
    holder_name_en: ' SYNTHETIC  HOLDER ',
    reason: `Changed account for SYNTHETIC HOLDER: ${registryIban}`,
  };
  const first = await ibanHttp(f, 'PUT', f.ibanPath, input);
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({
    iban: registryIban,
    holder_name_en: 'SYNTHETIC HOLDER',
    revision: 1,
    can_manage: true,
  });
  expect((await ibanHttp(f, 'PUT', f.ibanPath, { ...input, expected_revision: 1 })).body).toEqual(
    first.body,
  );
  const rows = await f.h
    .owner`SELECT * FROM employee_ibans WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['reason']).toBe(input.reason);
  const audits = await f.h
    .owner`SELECT * FROM audit_log WHERE company_id=${f.company} AND entity='employee_iban'`;
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    entity_id: rows[0]?.['id'],
    action: 'iban.set',
    actor_user_id: f.userId,
    before: null,
  });
  expect(audits[0]?.['after']).toEqual({
    entry_id: rows[0]?.['id'],
    revision: 1,
    iban_last4: '0101',
    bank_id: 'kw-cbk',
    cleared: false,
  });
  for (const value of [registryIban, 'SYNTHETIC HOLDER'])
    expect(JSON.stringify(audits)).not.toContain(value);
  expect(
    await f.h
      .owner`SELECT id FROM outbox WHERE company_id=${f.company} AND event_type ILIKE '%iban%'`,
  ).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT key FROM idempotency_keys WHERE company_id=${f.company} AND operation='set-employee-iban'`,
  ).toHaveLength(0);
});
it.each([
  [{ iban: 'KW12bad' }, 'IBAN_FORMAT_INVALID'],
  [{ iban: generatedIban(1, 'GB', '0'.repeat(18)) }, 'IBAN_COUNTRY_NOT_ALLOWED'],
  [{ iban: registryIban.slice(0, -1) + '2' }, 'IBAN_CHECKSUM_INVALID'],
  [{ bank_id: 'kw-nbk' }, 'IBAN_BANK_INVALID'],
  [{ bank_id: 'kw-other' }, 'IBAN_BANK_INVALID'],
  [{ bank_id: 'unknown' }, 'IBAN_BANK_INVALID'],
  [{ bank_id: 'sa-snb' }, 'IBAN_BANK_INVALID'],
  [{ holder_name_en: 'اسم' }, 'IBAN_HOLDER_NAME_INVALID'],
  [{ holder_name_en: 'A'.repeat(101) }, 'IBAN_HOLDER_NAME_INVALID'],
  [{ reason: ' ' }, 'VALIDATION_FAILED'],
  [{ iban: null }, 'VALIDATION_FAILED'],
] as const)('IB-03/13 refuses %j with %s and no write', async (change, code) => {
  const response = await ibanHttp(f, 'PUT', f.ibanPath, {
    ...ibanTerms(registryIban, 1),
    ...change,
  });
  expect(response.status).toBe(400);
  expect(response.body['code']).toBe(code);
  expect(
    await f.h
      .owner`SELECT id FROM employee_ibans WHERE company_id=${f.company} AND employee_id=${f.employee.id}`,
  ).toHaveLength(1);
});
it('validation error details never echo rejected IBAN or holder values, including strict extra fields', () => {
  try {
    new ZodValidationPipe(setEmployeeIbanInput).transform({
      ...ibanTerms(),
      iban: registryIban.repeat(3),
      holder_name_en: 'SYNTHETIC HOLDER'.repeat(30),
      [registryIban]: 'SYNTHETIC HOLDER',
    });
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const text = JSON.stringify((error as ApiError).toEnvelope());
    expect(text).not.toContain(registryIban);
    expect(text).not.toContain('SYNTHETIC HOLDER');
  }
});
it('IB-04/05/10/11 replaces, conflicts before no-op, clears once and pages immutable history', async () => {
  const replacement = generatedIban(2);
  expect((await ibanHttp(f, 'PUT', f.ibanPath, ibanTerms(replacement, 1))).body['revision']).toBe(
    2,
  );
  const stale = await ibanHttp(f, 'PUT', f.ibanPath, ibanTerms(replacement, 1));
  expect(stale.status).toBe(409);
  expect(stale.body['code']).toBe('EMPLOYEE_IBAN_REVISION_CONFLICT');
  const clear = {
    ...ibanTerms(),
    iban: null,
    bank_id: null,
    holder_name_en: null,
    expected_revision: 2,
  };
  const cleared = await ibanHttp(f, 'PUT', f.ibanPath, clear);
  expect(cleared.body).toMatchObject({
    status: 'NOT_SET',
    iban: null,
    bank_id: null,
    holder_name_en: null,
    revision: 3,
  });
  expect((await ibanHttp(f, 'PUT', f.ibanPath, { ...clear, expected_revision: 3 })).body).toEqual(
    cleared.body,
  );
  const page = await ibanHttp(f, 'GET', f.ibanPath + '/history?limit=1');
  expect(page.body).toMatchObject({
    items: [{ revision: 3, cleared: true, iban: null }],
    next_cursor: 3,
  });
  expect((await ibanHttp(f, 'GET', f.ibanPath + '/history?limit=1&cursor=3')).body).toMatchObject({
    items: [{ revision: 2, iban: replacement }],
    next_cursor: 2,
  });
  for (const query of ['limit=0', 'limit=101', 'cursor=0'])
    expect((await ibanHttp(f, 'GET', f.ibanPath + '/history?' + query)).status).toBe(400);
  const [audit] = await f.h
    .owner`SELECT * FROM audit_log WHERE company_id=${f.company} AND action='iban.cleared'`;
  expect(audit).toMatchObject({
    before: { revision: 2, cleared: false },
    after: { revision: 3, cleared: true },
  });
  const context = await newIbanEmployee(f);
  expect(
    (await f.setIban.execute({ ...context, input: { ...clear, expected_revision: 0 } })).revision,
  ).toBe(0);
});
it('IB-12 refuses company-wide duplicate without identity, permits changed/cleared/deleted history and other tenants', async () => {
  const a = await newIbanEmployee(f, f.secondBusiness);
  const b = await newIbanEmployee(f);
  const iban = generatedIban(12);
  await f.setIban.execute({ ...a, input: ibanTerms(iban) });
  const path = `/v1/businesses/${b.businessId}/employees/${b.employeeId}/iban`;
  const denied = await ibanHttp(f, 'PUT', path, ibanTerms(iban));
  expect(denied.status).toBe(409);
  expect(denied.body['code']).toBe('EMPLOYEE_IBAN_ALREADY_USED');
  for (const value of [a.employeeId, a.businessId, iban, 'SYNTHETIC HOLDER'])
    expect(denied.text).not.toContain(value);
  await f.setIban.execute({ ...a, input: ibanTerms(generatedIban(13), 1) });
  await f.setIban.execute({ ...b, input: ibanTerms(iban) });
  await f.setIban.execute({
    ...b,
    input: { ...ibanTerms(iban, 1), holder_name_en: 'UPDATED HOLDER' },
  });
  await f.setIban.execute({
    ...a,
    input: { ...ibanTerms('', 2), iban: null, bank_id: null, holder_name_en: null },
  });
  await f.setIban.execute({ ...b, input: ibanTerms(generatedIban(13), 2) });
  await f.h
    .owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${b.employeeId}`;
  await f.setIban.execute({ ...a, input: ibanTerms(generatedIban(13), 3) });
  const [foreign] = await f.h.owner`SELECT id FROM businesses WHERE company_id=${f.otherCompany}`;
  const foreignEmployee = await newIbanEmployee(f, foreign?.['id'] as string, f.otherCompany);
  expect(
    (await f.setIban.execute({ ...foreignEmployee, input: ibanTerms(generatedIban(13)) })).revision,
  ).toBe(1);
});
it('IB-12 two concurrent HTTP writers for the same account produce exactly one 200 and one 409', async () => {
  const contexts = [await newIbanEmployee(f), await newIbanEmployee(f, f.secondBusiness)];
  const results = await Promise.all(
    contexts.map((ctx) =>
      ibanHttp(
        f,
        'PUT',
        `/v1/businesses/${ctx.businessId}/employees/${ctx.employeeId}/iban`,
        ibanTerms(generatedIban(99)),
      ),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.status === 409)?.body['code']).toBe('EMPLOYEE_IBAN_ALREADY_USED');
});
it('rolls back both account and audit if work fails after saving', async () => {
  const actual = createEmployeeIbanTransactions(f.db, ibanIds);
  const broken = new SetEmployeeIbanUseCase(
    {
      run: (ctx, work) =>
        actual.run(ctx, async (tx) => {
          await work(tx);
          throw new Error('Synthetic failure');
        }),
    },
    ibanIds,
    GCC_BANKS,
  );
  const context = await newIbanEmployee(f);
  const before = await f.h
    .owner`SELECT id FROM audit_log WHERE company_id=${f.company} AND entity='employee_iban'`;
  await expect(
    broken.execute({ ...context, input: ibanTerms(generatedIban(100)) }),
  ).rejects.toThrow('EMPLOYEE_IBAN_PERSISTENCE_FAILED');
  expect(
    await f.h.owner`SELECT id FROM employee_ibans WHERE employee_id=${context.employeeId}`,
  ).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT id FROM audit_log WHERE company_id=${f.company} AND entity='employee_iban'`,
  ).toHaveLength(before.length);
});
it('IB-09 refuses an approved Device credential on every IBAN route', async () => {
  const code = await f.h.send('POST', `/v1/branches/${f.branch}/devices/pairing-code`, {
    cookie: f.cookie,
    company: f.company,
  });
  const registered = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: code.body['code'], label: 'Synthetic IBAN device' },
  });
  const device = registered.json<{ device_id: string; company_id: string; claim_secret: string }>();
  await f.h.send('POST', `/v1/branches/${f.branch}/devices/${device.device_id}/approve`, {
    cookie: f.cookie,
    company: f.company,
  });
  const claim = await f.h.app.inject({ method: 'POST', url: '/v1/devices/claim', payload: device });
  expect(claim.statusCode).toBe(200);
  const token = claim.json<{ device_token: string }>().device_token;
  for (const [method, suffix] of [
    ['GET', ''],
    ['GET', '/history'],
    ['PUT', ''],
  ] as const) {
    const response = await f.h.app.inject({
      method,
      url: f.ibanPath + suffix,
      headers: { authorization: `Device ${token}`, 'x-company-id': f.company },
      ...(method === 'PUT' ? { payload: ibanTerms() } : {}),
    });
    expect(response.statusCode).toBe(403);
  }
});
it('IB-07/08/09 masks employee managers, denies writes/history uniformly and checks feature after access', async () => {
  await f.setIban.execute({ ...f.context, input: ibanTerms(registryIban, 3) });
  const [role] = await f.h
    .owner`SELECT id FROM roles WHERE company_id=${f.company} AND code='synthetic_employee_editor'`;
  await f.h
    .owner`UPDATE memberships SET role_id=${role?.['id'] as string},role_owner_key=${f.company} WHERE company_id=${f.company} AND id=${f.memberId}`;
  const masked = await ibanHttp(f, 'GET');
  expect(masked.body).toMatchObject({
    iban_last4: '0101',
    iban: null,
    bank_id: null,
    holder_name_en: null,
    set_by: null,
    can_read_full: false,
    can_manage: false,
  });
  for (const text of [registryIban, 'kw-cbk', 'SYNTHETIC HOLDER'])
    expect(masked.text).not.toContain(text);
  const statements = f.h.calls.statements.filter((s) => /FROM employee_ibans/.test(s.sql));
  const last = statements.at(-1)?.sql ?? '';
  expect(last).toContain('right(iban,4)');
  expect(last).not.toMatch(/bank_id|holder_name_en|set_by/);
  const denied = await ibanHttp(f, 'PUT', f.ibanPath, ibanTerms(registryIban, 4));
  expect(denied.status).toBe(404);
  expect((await ibanHttp(f, 'GET', f.ibanPath + '/history')).body).toEqual(denied.body);
  for (const path of [
    f.ibanPath.replace(f.employee.id, ibanIds.newId()),
    f.ibanPath.replace(f.business, f.secondBusiness),
  ]) {
    for (const suffix of ['', '/history'])
      expect((await ibanHttp(f, 'GET', path + suffix)).body).toEqual(denied.body);
    expect((await ibanHttp(f, 'PUT', path, ibanTerms())).body).toEqual(denied.body);
  }
  for (const method of ['GET', 'PUT'] as const)
    expect(
      (
        await ibanHttp(
          f,
          method,
          f.ibanPath,
          method === 'PUT' ? ibanTerms() : undefined,
          f.otherCompany,
        )
      ).body,
    ).toEqual(denied.body);
});
it('checks the feature after permission and hides deleted employees', async () => {
  const denied = await ibanHttp(f, 'PUT', f.ibanPath, ibanTerms());
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES (${f.company},'staff',false,'Synthetic',${f.userId})`;
  expect((await ibanHttp(f, 'GET')).body['code']).toBe('FEATURE_DISABLED');
  expect((await ibanHttp(f, 'PUT', f.ibanPath, ibanTerms())).body).toEqual(denied.body);
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.memberId}`;
  expect((await ibanHttp(f, 'GET')).body).toEqual(denied.body);
  await f.h
    .owner`UPDATE memberships SET role_id=${OWNER_ROLE_ID},role_owner_key='global' WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.h
    .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  await f.h
    .owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${f.employee.id}`;
  for (const suffix of ['', '/history'])
    expect((await ibanHttp(f, 'GET', f.ibanPath + suffix)).body).toEqual(denied.body);
  expect((await ibanHttp(f, 'PUT', f.ibanPath, ibanTerms())).body).toEqual(denied.body);
});
