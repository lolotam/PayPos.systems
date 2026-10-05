import { service, servicePage } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { CreateServiceUseCase } from '../use-cases/create-service/create-service.usecase.ts';
import {
  servicesFixture,
  grantServices,
  detailFor,
  termsFor,
  type ServiceFixture,
} from './services.fixture.ts';

const ids = systemUuidV7();
let f: ServiceFixture;
let createdId: string;

beforeAll(async () => {
  f = await servicesFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const post = (body: object, business = f.business) =>
  f.h.send('POST', `/v1/businesses/${business}/services`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const patch = (serviceId: string, body: object, business = f.business) =>
  f.h.app.inject({
    method: 'PATCH',
    url: `/v1/businesses/${business}/services/${serviceId}`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload: body,
  });
const getOne = (serviceId: string, business = f.business) =>
  f.h.send('GET', `/v1/businesses/${business}/services/${serviceId}`, {
    cookie: f.cookie,
    company: f.company,
  });

it('SV-07 default bundles grant managers; an ungranted membership is refused, and the route needs a session', async () => {
  expect(
    await f.h
      .owner`SELECT 1 FROM role_permissions WHERE permission_code='manage:services:business'`,
  ).toHaveLength(3);
  expect(
    await f.h.owner`SELECT 1 FROM role_permissions WHERE permission_code='read:services:business'`,
  ).toHaveLength(3);
  expect((await post(termsFor())).status).toBe(403);
  expect(
    (
      await f.h.app.inject({
        method: 'POST',
        url: `/v1/businesses/${f.business}/services`,
        payload: termsFor(),
      })
    ).statusCode,
  ).toBe(401);
  await grantServices(f, f.business, 'manage:services:business');
  await grantServices(f, f.business, 'read:services:business');
});

it('SV-01 creates the row and its audit in one transaction, emits no event, and echoes the contract', async () => {
  const result = await post({
    ...termsFor('Haircut'),
    name_ar: 'قص شعر',
    price: '7.500',
    commission_rule: { kind: 'PCT', value: 2500 },
    counts_toward_threshold: false,
  });
  expect(result.status).toBe(201);
  const record = service.parse(result.body);
  createdId = record.id;
  expect(record.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-7/);
  expect(record).toMatchObject({
    business_id: f.business,
    name_en: 'Haircut',
    name_ar: 'قص شعر',
    price: '7.500',
    commission_rule: { kind: 'PCT', value: 2500 },
    counts_toward_threshold: false,
    revision: 1,
  });
  expect(
    await f.h
      .owner`SELECT price::text,commission_rule_kind,commission_pct_bps,commission_fixed_amount,counts_toward_threshold FROM services WHERE company_id=${f.company} AND id=${createdId}`,
  ).toEqual([
    {
      price: '7.500',
      commission_rule_kind: 'PCT',
      commission_pct_bps: 2500,
      commission_fixed_amount: null,
      counts_toward_threshold: false,
    },
  ]);
  expect(
    await f.h
      .owner`SELECT actor_user_id,action,after FROM audit_log WHERE company_id=${f.company} AND entity='service' AND entity_id=${createdId}`,
  ).toEqual([
    {
      actor_user_id: f.userId,
      action: 'created',
      after: record,
    },
  ]);
  expect(await f.h.owner`SELECT 1 FROM outbox WHERE aggregate_id=${createdId}`).toHaveLength(0);
  expect(await detailFor(f, f.company, f.business, createdId)).toMatchObject(record);
});

it('SV-04 refuses malformed bodies and named rule values without a partial write', async () => {
  const before = await f.h.owner`SELECT count(*) AS n FROM services`;
  for (const change of [
    { name_en: '  ' },
    { name_en: 'a\u0001b' },
    { price: '12.5' },
    { price: '-1.000' },
    { commission_rule: { kind: 'PCT', value: 10_001 } },
    { commission_rule: { kind: 'PCT', value: -1 } },
    { commission_rule: { kind: 'ZERO', value: 5 } },
    { unexpected: true },
  ]) {
    const response = await post({ ...termsFor(ids.newId()), ...change });
    expect(response.body['code']).toBe('VALIDATION_FAILED');
    expect(response.status).toBe(400);
    expect(response.body['message_ar']).toEqual(expect.any(String));
  }
  expect(await f.h.owner`SELECT count(*) AS n FROM services`).toEqual(before);
});

it('SV-06 updates price and rule, bumps revision once and audits before/after', async () => {
  const response = await patch(createdId, {
    expected_revision: 1,
    name_en: 'Haircut',
    name_ar: 'قص شعر',
    price: '8.000',
    commission_rule: { kind: 'FIXED', value: '1.500' },
    counts_toward_threshold: false,
  });
  expect(response.statusCode).toBe(200);
  const record = service.parse(response.json());
  expect(record).toMatchObject({
    id: createdId,
    price: '8.000',
    commission_rule: { kind: 'FIXED', value: '1.500' },
    revision: 2,
  });
  expect(
    await f.h.owner`SELECT action,before->>'price' AS before_price,after->>'price' AS after_price,
      before->'commission_rule' AS before_rule,after->'commission_rule' AS after_rule
      FROM audit_log WHERE company_id=${f.company} AND entity='service' AND entity_id=${createdId} AND action='updated'`,
  ).toEqual([
    {
      action: 'updated',
      before_price: '7.500',
      after_price: '8.000',
      before_rule: { kind: 'PCT', value: 2500 },
      after_rule: { kind: 'FIXED', value: '1.500' },
    },
  ]);
  const rows = await f.h
    .owner`SELECT id FROM services WHERE company_id=${f.company} AND id=${createdId}`;
  expect(rows).toHaveLength(1);
});

it('SV-06b a no-op update keeps the revision and writes no second audit row', async () => {
  const audits = async () =>
    Number(
      (
        await f.h
          .owner`SELECT count(*)::int AS n FROM audit_log WHERE company_id=${f.company} AND entity='service' AND entity_id=${createdId}`
      )[0]?.['n'] ?? 0,
    );
  const before = await audits();
  const response = await patch(createdId, {
    expected_revision: 2,
    name_en: 'Haircut',
    name_ar: 'قص شعر',
    price: '8.000',
    commission_rule: { kind: 'FIXED', value: '1.500' },
    counts_toward_threshold: false,
  });
  expect(response.statusCode).toBe(200);
  expect(service.parse(response.json()).revision).toBe(2);
  expect(await audits()).toBe(before);
});

it('SV-06c a stale revision is refused with SERVICE_REVISION_CONFLICT', async () => {
  const response = await patch(createdId, {
    expected_revision: 1,
    ...termsFor('Haircut'),
    price: '9.000',
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({
    code: 'SERVICE_REVISION_CONFLICT',
    message_ar: expect.any(String),
    message_en: expect.any(String),
  });
});

it('SV-06d an update omitting name_ar or counts_toward_threshold is refused, never reset to create defaults', async () => {
  const full = {
    expected_revision: 2,
    name_en: 'Haircut',
    name_ar: 'قص شعر',
    price: '8.000',
    commission_rule: { kind: 'FIXED', value: '1.500' },
    counts_toward_threshold: false,
  };
  for (const omitted of ['counts_toward_threshold', 'name_ar']) {
    const body = Object.fromEntries(Object.entries(full).filter(([key]) => key !== omitted));
    const response = await patch(createdId, body);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  }
  expect(
    await f.h
      .owner`SELECT name_ar,counts_toward_threshold,revision FROM services WHERE company_id=${f.company} AND id=${createdId}`,
  ).toEqual([{ name_ar: 'قص شعر', counts_toward_threshold: false, revision: 2 }]);
});

it('SV-01b a foreign or unknown service id answers SERVICE_NOT_FOUND for read and write', async () => {
  const unknown = ids.newId();
  expect((await getOne(unknown)).status).toBe(404);
  expect((await getOne(unknown)).body['code']).toBe('SERVICE_NOT_FOUND');
  const response = await patch(unknown, { expected_revision: 1, ...termsFor() });
  expect(response.statusCode).toBe(404);
  // خدمة أنشأناها في نشاط تاني لنفس الشركة لا تظهر من هذا النشاط.
  expect(await detailFor(f, f.company, f.secondBusiness, createdId)).toBeNull();
});

it('SV-07b a business outside the membership grant is refused like any other unauthorized target', async () => {
  expect((await post(termsFor(), f.foreignBusiness)).status).toBe(403);
  expect(
    (
      await f.h.send('GET', `/v1/businesses/${f.foreignBusiness}/services`, {
        cookie: f.cookie,
        company: f.company,
      })
    ).status,
  ).toBe(403);
});

it('SV-07c the catalog feature flag can close the whole slice', async () => {
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES (${f.company},'catalog',false,'Synthetic disabled',${f.userId})`;
  try {
    expect((await post(termsFor('Disabled'))).body['code']).toBe('FEATURE_DISABLED');
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='catalog'`;
  }
});

it('SV-09 rolls the whole write back when the audit insert fails', async () => {
  const transactions = {
    run: <T>(
      actor: { companyId: string; userId: string },
      work: Parameters<typeof f.transactions.run<T>>[1],
    ) =>
      f.transactions.run(actor, (scope) =>
        work({
          ...scope,
          audit: async () => {
            throw new Error('Synthetic audit failure');
          },
        }),
      ),
  };
  const failing = new CreateServiceUseCase(transactions, ids, { now: () => new Date() });
  await expect(
    failing.execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      input: termsFor('Rollback service'),
    }),
  ).rejects.toThrow('SERVICE_PERSISTENCE_FAILED');
  expect(await f.h.owner`SELECT 1 FROM services WHERE name_en='Rollback service'`).toHaveLength(0);
});

it('SV-08 lists cursor pages with exact projections and no duplicate rows', async () => {
  const names = ['List A', 'List B', 'List C'];
  for (const name of names) {
    expect((await post(termsFor(name))).status).toBe(201);
  }
  const first = servicePage.parse(
    (
      await f.h.send('GET', `/v1/businesses/${f.business}/services?limit=2`, {
        cookie: f.cookie,
        company: f.company,
      })
    ).body,
  );
  expect(first.items).toHaveLength(2);
  expect(first.next_cursor).toEqual(first.items[1]?.id);
  const second = servicePage.parse(
    (
      await f.h.send(
        'GET',
        `/v1/businesses/${f.business}/services?limit=2&cursor=${first.next_cursor ?? ''}`,
        { cookie: f.cookie, company: f.company },
      )
    ).body,
  );
  const seen = [...first.items, ...second.items].map((item) => item.id);
  expect(new Set(seen).size).toBe(seen.length);
  expect(
    (
      await f.h.send('GET', `/v1/businesses/${f.business}/services?limit=101`, {
        cookie: f.cookie,
        company: f.company,
      })
    ).status,
  ).toBe(400);
});

it('two concurrent editors cannot overwrite one revision or lose its audit', async () => {
  const made = await post(termsFor('Concurrent service'));
  const current = service.parse(made.body);
  const responses = await Promise.all([
    patch(current.id, { ...termsFor('Editor A'), expected_revision: 1, price: '1.001' }),
    patch(current.id, { ...termsFor('Editor B'), expected_revision: 1, price: '2.002' }),
  ]);
  expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const winner = service.parse(responses.find((r) => r.statusCode === 200)?.json());
  expect(await detailFor(f, f.company, f.business, current.id)).toEqual(winner);
  expect(winner.revision).toBe(2);
  expect(
    await f.h.owner`SELECT before,after FROM audit_log WHERE company_id=${f.company}
    AND entity='service' AND entity_id=${current.id} AND action='updated'`,
  ).toEqual([{ before: current, after: winner }]);
});

it('foreign tenant and business services share the unknown read/update envelope', async () => {
  const targets = [
    { companyId: f.company, businessId: f.secondBusiness },
    { companyId: f.otherCompany, businessId: f.foreignBusiness },
  ];
  const unknown = ids.newId();
  const missingRead = await getOne(unknown);
  const missingWrite = await patch(unknown, { ...termsFor(), expected_revision: 1 });
  for (const target of targets) {
    const foreign = await f.create.execute({ ...target, userId: f.userId, input: termsFor() });
    const read = await getOne(foreign.id);
    const write = await patch(foreign.id, { ...termsFor(), expected_revision: 1 });
    expect({ status: read.status, body: read.body }).toEqual({
      status: missingRead.status,
      body: missingRead.body,
    });
    expect({ status: write.statusCode, body: write.json() }).toEqual({
      status: missingWrite.statusCode,
      body: missingWrite.json(),
    });
  }
});

it('Device role cannot use service routes even with historical business ALLOWs', async () => {
  const [previous] = await f.h.owner`SELECT role_id,role_owner_key FROM memberships
    WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.h
    .owner`UPDATE memberships SET role_id='01920000-0000-7000-8000-00000000010e',role_owner_key='global'
    WHERE company_id=${f.company} AND id=${f.memberId}`;
  try {
    expect((await post(termsFor('Device refused'))).status).toBe(403);
    expect((await getOne(createdId)).status).toBe(403);
    expect((await patch(createdId, { ...termsFor(), expected_revision: 2 })).statusCode).toBe(403);
    expect(
      (
        await f.h.send('GET', `/v1/businesses/${f.business}/services`, {
          cookie: f.cookie,
          company: f.company,
        })
      ).status,
    ).toBe(403);
  } finally {
    await f.h.owner`UPDATE memberships SET role_id=${previous?.['role_id'] as string},
      role_owner_key=${previous?.['role_owner_key'] as string}
      WHERE company_id=${f.company} AND id=${f.memberId}`;
  }
});
