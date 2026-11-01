import {
  commissionServiceOverride,
  commissionServiceOverrideList,
  type CreateCommissionServiceOverrideInput,
} from '@pospay/contracts';
import postgres from 'postgres';
import { afterEach, beforeEach, expect, it } from 'vitest';

import {
  closeCommissionFixture,
  ids,
  setCommissionStatement,
} from './commission-plan-versions.fixture.ts';
import {
  commissionServiceOverridesFixture,
  overrideAndAuditCounts,
  overrideInput,
  type CommissionServiceOverrideFixture,
} from './commission-service-overrides.fixture.ts';

let f: CommissionServiceOverrideFixture;
beforeEach(async () => {
  f = await commissionServiceOverridesFixture();
});
afterEach(async () => {
  await closeCommissionFixture(f);
});

it.each([
  { label: 'FOLLOW_PLAN', rule: { kind: 'FOLLOW_PLAN' } },
  { label: 'ZERO', rule: { kind: 'ZERO' } },
  { label: 'PCT', rule: { kind: 'PCT', value: 1500 } },
  { label: 'FIXED', rule: { kind: 'FIXED', value: '12.500' } },
] satisfies { label: string; rule: CreateCommissionServiceOverrideInput['rule'] }[])(
  'POST stores the $label rule and answers with the saved row',
  async ({ label, rule }) => {
    const response = await f.postOverride(overrideInput(f, { rule }), `cm-http-${label}`);
    expect(response.status).toBe(201);
    expect(commissionServiceOverride.parse(response.body)).toEqual({
      id: expect.any(String),
      employee_id: f.employee,
      service_id: f.service,
      rule,
      effective_from: '2026-10-30',
      created_at: '2026-10-30T12:00:00.000Z',
      created_by: f.userId,
    });
    expect(await overrideAndAuditCounts(f)).toEqual([1, 1]);
    const listed = await f.getOverrides();
    expect(listed.status).toBe(200);
    expect(commissionServiceOverrideList.parse(listed.body).items[0]?.rule).toEqual(rule);
  },
);

it('POST refuses an extra body key, unapproved rule kinds and a past date', async () => {
  const extra = await f.postOverride(
    { ...overrideInput(f), whole_period: false },
    'cm-http-extra-key',
  );
  expect([extra.status, extra.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
  const unknown = await f.postOverride(
    overrideInput(f, {
      rule: { kind: 'NOPE' } as unknown as CreateCommissionServiceOverrideInput['rule'],
    }),
    'cm-http-unknown-rule',
  );
  expect([unknown.status, unknown.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
  const followService = await f.postOverride(
    overrideInput(f, {
      rule: { kind: 'FOLLOW_SERVICE' } as unknown as CreateCommissionServiceOverrideInput['rule'],
    }),
    'cm-http-follow-service',
  );
  expect([followService.status, followService.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
  const past = await f.postOverride(
    overrideInput(f, { effective_from: '2026-10-29' }),
    'cm-http-past',
  );
  expect([past.status, past.body['code']]).toEqual([422, 'COMMISSION_EFFECTIVE_FROM_PAST']);
  expect(await overrideAndAuditCounts(f)).toEqual([0, 0]);
});

it('POST refuses a missing service, a service of another business and a missing employee', async () => {
  const missing = await f.postOverride(
    overrideInput(f, { service_id: ids.newId() }),
    'cm-http-missing-service',
  );
  expect([missing.status, missing.body['code']]).toEqual([404, 'SERVICE_NOT_FOUND']);
  const otherBusiness = await f.postOverride(
    overrideInput(f, { service_id: f.otherBusinessService }),
    'cm-http-other-business',
  );
  expect([otherBusiness.status, otherBusiness.body['code']]).toEqual([404, 'SERVICE_NOT_FOUND']);
  const otherTenant = await f.postOverride(
    overrideInput(f, { service_id: f.otherTenantService }),
    'cm-http-other-tenant',
  );
  expect([otherTenant.status, otherTenant.body['code']]).toEqual([404, 'SERVICE_NOT_FOUND']);
  const noEmployee = await f.postOverride(overrideInput(f), 'cm-http-no-employee', ids.newId());
  expect([noEmployee.status, noEmployee.body['code']]).toEqual([404, 'EMPLOYEE_NOT_FOUND']);
  expect(await overrideAndAuditCounts(f)).toEqual([0, 0]);
});

it('POST refuses a closed period with COMMISSION_PERIOD_CLOSED', async () => {
  await setCommissionStatement(f, '2026-10', 'APPROVED');
  const response = await f.postOverride(overrideInput(f), 'cm-http-closed');
  expect([response.status, response.body['code']]).toEqual([409, 'COMMISSION_PERIOD_CLOSED']);
  expect(await overrideAndAuditCounts(f)).toEqual([0, 0]);
});

it('POST replays the same key and body once and refuses the same key with another body', async () => {
  const first = await f.postOverride(overrideInput(f), 'cm-http-replay');
  const replay = await f.postOverride(overrideInput(f), 'cm-http-replay');
  expect(replay.status).toBe(201);
  expect(replay.body).toEqual(first.body);
  expect(await overrideAndAuditCounts(f)).toEqual([1, 1]);
  const changed = await f.postOverride(
    overrideInput(f, { rule: { kind: 'ZERO' } }),
    'cm-http-replay',
  );
  expect([changed.status, changed.body['code']]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED']);
  expect(await overrideAndAuditCounts(f)).toEqual([1, 1]);
});

it('POST without an Idempotency-Key is a 400 and a busy key is a 409', async () => {
  const missing = await f.h.send('POST', f.overridePath(f.business, f.employee), {
    cookie: f.cookie,
    company: f.company,
    body: overrideInput(f),
  });
  expect([missing.status, missing.body['code']]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
  const holder = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await holder.unsafe('BEGIN');
    // مطالبة مفتاح شغالة: الطلب هيستنى عليها لحد ما مهلة القفل تخلص.
    await holder`INSERT INTO idempotency_keys(
      scope_type,scope_id,company_id,user_id,operation,key,request_fingerprint,expires_at)
      VALUES ('COMPANY',${f.company},${f.company},${f.userId},'create-commission-service-override',
        'cm-http-busy',${'a'.repeat(64)},now() + interval '24 hours')`;
    const busy = await f.postOverride(overrideInput(f), 'cm-http-busy');
    expect([busy.status, busy.body['code']]).toEqual([409, 'IDEMPOTENCY_KEY_IN_PROGRESS']);
    expect(await overrideAndAuditCounts(f)).toEqual([0, 0]);
  } finally {
    await holder.unsafe('ROLLBACK').catch(() => undefined);
    await holder.end();
  }
});
