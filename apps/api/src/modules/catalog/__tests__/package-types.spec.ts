import { packageTypeDetail } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { CreatePackageTypeUseCase } from '../use-cases/create-package-type/create-package-type.usecase.ts';
import { UpdatePackageTypeUseCase } from '../use-cases/update-package-type/update-package-type.usecase.ts';
import {
  packageTypesFixture,
  packageTerms,
  grantPackages,
  type PackageFixture,
} from './package-types.fixture.ts';

const ids = systemUuidV7();
let f: PackageFixture;
let made: ReturnType<typeof packageTypeDetail.parse>;
beforeAll(async () => {
  f = await packageTypesFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const post = (body: object, business = f.business) =>
  f.h.send('POST', `/v1/businesses/${business}/package-types`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const get = (id: string, business = f.business) =>
  f.h.send('GET', `/v1/businesses/${business}/package-types/${id}`, {
    cookie: f.cookie,
    company: f.company,
  });
const patch = (id: string, body: object) =>
  f.h.app.inject({
    method: 'PATCH',
    url: `/v1/businesses/${f.business}/package-types/${id}`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload: body,
  });

it('PT-08 requires permission and session; seeds only the three managers', async () => {
  expect((await post(packageTerms(f))).status).toBe(403);
  expect(
    (await f.h.app.inject({ method: 'GET', url: `/v1/businesses/${f.business}/package-types` }))
      .statusCode,
  ).toBe(401);
  for (const permission of ['manage:package-types:business', 'read:package-types:business'])
    expect(
      await f.h.owner`SELECT 1 FROM role_permissions WHERE permission_code=${permission}`,
    ).toHaveLength(3);
  await grantPackages(f);
});
it('PT-01/02/11 creates ordered mixed components, allows free services, audits exactly once without an event', async () => {
  const input = {
    ...packageTerms(f),
    name_ar: 'باقة',
    components: [2, 0, 1].map((i) => ({ service_id: f.services[i]?.id ?? '', sessions: i + 1 })),
  };
  const response = await post(input);
  expect(response.status).toBe(201);
  made = packageTypeDetail.parse(response.body);
  expect(made).toMatchObject({ ...input, revision: 1 });
  expect(made.components[1]?.price).toBe('0.000');
  expect(made.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-7/);
  expect((await get(made.id)).body).toEqual(made);
  const header = { ...made };
  expect(
    await f.h
      .owner`SELECT actor_user_id,action,after FROM audit_log WHERE entity='package_type' AND entity_id=${made.id}`,
  ).toEqual([
    {
      actor_user_id: f.userId,
      action: 'created',
      after: { ...header, components: input.components },
    },
  ]);
  expect(await f.h.owner`SELECT 1 FROM outbox WHERE aggregate_id=${made.id}`).toHaveLength(0);
});
it('PT-03 rejects every invalid definition by name without a partial write', async () => {
  const before = await f.h.owner`SELECT count(*) FROM package_types`;
  const component = packageTerms(f).components[0];
  if (component === undefined) throw new Error('Missing component fixture');
  const cases = [
    [{ components: [] }, 'INVALID_COMPONENTS'],
    [{ components: [component, component] }, 'DUPLICATE_SERVICE'],
    ...[0, 366, 1.5].map((sessions) => [
      { components: [{ ...component, sessions }] },
      'INVALID_SESSIONS',
    ]),
    ...['-1.000', '25.5', '100000000000.000'].map((price) => [{ price }, 'PRICE_INVALID']),
    ...[0, 731, 1.5].map((validity_days) => [{ validity_days }, 'VALIDITY_INVALID']),
    [{ name_en: ' ' }, 'NAME_INVALID'],
  ] as const;
  for (const [change, suffix] of cases) {
    const result = await post({ ...packageTerms(f), ...(change as object) });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      code: `PACKAGE_TYPE_${suffix}`,
      message_ar: expect.any(String),
      message_en: expect.any(String),
    });
  }
  expect(await f.h.owner`SELECT count(*) FROM package_types`).toEqual(before);
});
it('PT-04 unknown, cross-business and cross-company services have an identical create/update refusal', async () => {
  const foreignIds = [ids.newId()];
  for (const [companyId, businessId] of [
    [f.company, f.secondBusiness],
    [f.otherCompany, f.foreignBusiness],
  ]) {
    const service = await f.create.execute({
      companyId: companyId ?? '',
      businessId: businessId ?? '',
      userId: f.userId,
      input: { name_en: 'Foreign service', price: '0.000', commission_rule: { kind: 'ZERO' } },
    });
    foreignIds.push(service.id);
  }
  const replies = [];
  const auditBefore = await f.h.owner`SELECT count(*) FROM audit_log`;
  for (const service_id of foreignIds) {
    const input = { ...packageTerms(f), components: [{ service_id, sessions: 1 }] };
    replies.push(await post(input));
    const response = await patch(made.id, { ...input, expected_revision: made.revision });
    replies.push({ status: response.statusCode, body: response.json() });
  }
  for (const reply of replies) {
    expect(reply.status).toBe(400);
    expect(reply.body).toEqual(replies[0]?.body);
    expect(reply.body['code']).toBe('PACKAGE_TYPE_SERVICE_NOT_FOUND');
  }
  expect((await get(made.id)).body).toEqual(made);
  expect(await f.h.owner`SELECT count(*) FROM audit_log`).toEqual(auditBefore);
});
it('accepts a free promotional package through POST and preserves its zero price', async () => {
  const input = { ...packageTerms(f, 'Free promotional package'), price: '0.000' };
  const response = await post(input);
  expect(response.status).toBe(201);
  const record = packageTypeDetail.parse(response.body);
  expect(record).toMatchObject({ ...input, revision: 1 });
  expect((await get(record.id)).body).toEqual(record);
});
it('PT-05/06/07 replaces all fields, retains before/after components and detects stale/no-op updates', async () => {
  const body = {
    ...packageTerms(f, 'Updated package'),
    name_ar: 'جديد',
    price: '27.500',
    validity_days: 730,
    components: [{ service_id: f.services[1]?.id ?? '', sessions: 365 }],
    expected_revision: 1,
  };
  const response = await patch(made.id, body);
  expect(response.statusCode).toBe(200);
  const updated = packageTypeDetail.parse(response.json());
  expect(updated).toMatchObject({
    revision: 2,
    price: '27.500',
    validity_days: 730,
    components: body.components,
  });
  const audits = await f.h
    .owner`SELECT before,after FROM audit_log WHERE entity='package_type' AND entity_id=${made.id} AND action='updated'`;
  expect(audits).toHaveLength(1);
  expect(audits[0]?.['before']).toMatchObject({
    revision: 1,
    components: made.components.map(({ service_id, sessions }) => ({ service_id, sessions })),
  });
  expect(audits[0]?.['after']).toMatchObject({ revision: 2, components: body.components });
  expect(audits[0]?.['after']).not.toHaveProperty('expected_revision');
  expect((await patch(made.id, body)).statusCode).toBe(409);
  expect((await patch(made.id, { ...body, expected_revision: 2 })).json()).toEqual(updated);
  expect(
    await f.h.owner`SELECT 1 FROM audit_log WHERE entity='package_type' AND entity_id=${made.id}`,
  ).toHaveLength(2);
  for (const field of ['name_ar', 'price', 'validity_days', 'components']) {
    const incomplete = Object.fromEntries(
      Object.entries({ ...body, expected_revision: 2 }).filter(([key]) => key !== field),
    );
    expect((await patch(made.id, incomplete)).statusCode).toBe(400);
  }
});
it('PT-10 names collide ignoring case and spaces on creation and rename, Arabic included', async () => {
  const first = await post({ ...packageTerms(f, 'Unique name'), name_ar: 'فريدة' });
  expect(first.status).toBe(201);
  for (const input of [
    { ...packageTerms(f, ' UNIQUE NAME ') },
    { ...packageTerms(f, 'Other name'), name_ar: ' فريدة ' },
  ]) {
    expect((await post(input)).body['code']).toBe('PACKAGE_TYPE_NAME_TAKEN');
    const result = await patch(made.id, { ...input, expected_revision: 2 });
    expect(result.statusCode).toBe(409);
    expect(result.json()).toMatchObject({ code: 'PACKAGE_TYPE_NAME_TAKEN' });
  }
});
it('PT-12 accepts 20 components and 730 days, rejects 21 without writing', async () => {
  const components = f.services.map((s) => ({ service_id: s.id, sessions: 1 }));
  expect(
    (
      await post({
        ...packageTerms(f, 'Twenty'),
        validity_days: 730,
        price: '99999999999.999',
        components: components.slice(0, 20),
      })
    ).status,
  ).toBe(201);
  expect((await post({ ...packageTerms(f, 'Twenty one'), components })).body['code']).toBe(
    'PACKAGE_TYPE_INVALID_COMPONENTS',
  );
});
it('PT-05 reorders all 20 components without transient position conflicts', async () => {
  const input = {
    ...packageTerms(f, 'Reordered package'),
    components: f.services.slice(0, 20).map((service) => ({ service_id: service.id, sessions: 1 })),
  };
  const created = await post(input);
  expect(created.status).toBe(201);
  const current = packageTypeDetail.parse(created.body);
  const components = [...input.components].reverse();
  const response = await patch(current.id, {
    ...input,
    components,
    expected_revision: current.revision,
  });
  expect(response.statusCode).toBe(200);
  const updated = packageTypeDetail.parse(response.json());
  expect(updated).toMatchObject({ revision: 2, components });
  expect((await get(current.id)).body).toEqual(updated);
});
it('two concurrent editors and two duplicate-name creators each produce one winner', async () => {
  const current = packageTypeDetail.parse((await post(packageTerms(f, 'Concurrent'))).body);
  const updates = await Promise.all(
    ['A', 'B'].map((name) => patch(current.id, { ...packageTerms(f, name), expected_revision: 1 })),
  );
  expect(updates.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const creates = await Promise.all([
    post(packageTerms(f, 'Race')),
    post(packageTerms(f, ' race ')),
  ]);
  expect(creates.map((r) => r.status).sort()).toEqual([201, 409]);
});
it('audit failure rolls back creation and restores deleted components on an edit', async () => {
  const transactions = {
    run: <T>(
      actor: { companyId: string; userId: string },
      work: Parameters<typeof f.packageTransactions.run<T>>[1],
    ) =>
      f.packageTransactions.run(actor, (scope) =>
        work({
          ...scope,
          audit: async () => {
            throw new Error('Synthetic failure');
          },
        }),
      ),
  };
  const create = new CreatePackageTypeUseCase(transactions, ids, { now: () => new Date() });
  await expect(
    create.execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      input: packageTerms(f, 'Rollback'),
    }),
  ).rejects.toThrow('PACKAGE_TYPE_PERSISTENCE_FAILED');
  expect(await f.h.owner`SELECT 1 FROM package_types WHERE name_en='Rollback'`).toHaveLength(0);
  const before = packageTypeDetail.parse((await get(made.id)).body);
  const update = new UpdatePackageTypeUseCase(transactions, { now: () => new Date() });
  await expect(
    update.execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      packageTypeId: made.id,
      input: { ...packageTerms(f, 'Rollback edit'), expected_revision: before.revision },
    }),
  ).rejects.toThrow('PACKAGE_TYPE_PERSISTENCE_FAILED');
  expect((await get(made.id)).body).toEqual(before);
});
