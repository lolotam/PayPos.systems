import { service, type Service } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { grantServices, servicesFixture, type ServiceFixture } from './services.fixture.ts';

const ids = systemUuidV7();

let f: ServiceFixture;

/** صلاحية الإغلاق كود جديد مش في مساعد الخدمات، فبنمنحه للعضو بنفس طريقة المنح اللي فيه. */
async function grantServicePermission(fixture: ServiceFixture): Promise<void> {
  await fixture.h.owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${fixture.company},${ids.newId()},${fixture.memberId},'close:services:business','ALLOW','BUSINESS',${fixture.business},'Synthetic grant',${fixture.userId})`;
}

/**
 * عضو بصلاحية قراءة الخدمات بس: دور وعضوية مستقلين، فالعضو الجديد ما بيورثش صلاحية الإغلاق
 * من عضوية مساعد الـ fixture.
 */
async function readOnlyMember(fixture: ServiceFixture): Promise<{ cookie: string }> {
  const email = `service-read-only-${ids.newId()}@example.test`;
  const cookie = await fixture.h.signedInOperator(email);
  const [holder] = await fixture.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const role = ids.newId();
  const memberId = ids.newId();
  await fixture.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${fixture.company},'synthetic_service_reader','Synthetic service reader')`;
  await fixture.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${fixture.company},${memberId},${holder?.['id'] as string},${role},${fixture.company},'COMPANY',${fixture.company})`;
  await fixture.h.owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${fixture.company},${ids.newId()},${memberId},'read:services:business','ALLOW','BUSINESS',${fixture.business},'Synthetic grant',${fixture.userId})`;
  return { cookie };
}

beforeAll(async () => {
  f = await servicesFixture();
  await grantServices(f, f.business, 'manage:services:business');
  await grantServices(f, f.business, 'read:services:business');
  await grantServicePermission(f);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const createService = (body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/services`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const closeService = (serviceId: string, body: object, cookie = f.cookie) =>
  f.h.send('POST', `/v1/businesses/${f.business}/services/${serviceId}/close`, {
    cookie,
    company: f.company,
    body,
  });
const reopenService = (serviceId: string, body: object, cookie = f.cookie) =>
  f.h.send('POST', `/v1/businesses/${f.business}/services/${serviceId}/reopen`, {
    cookie,
    company: f.company,
    body,
  });
const readService = (serviceId: string) =>
  f.h.send('GET', `/v1/businesses/${f.business}/services/${serviceId}`, {
    cookie: f.cookie,
    company: f.company,
  });

async function makeService(name: string): Promise<Service> {
  const response = await createService({
    name_en: name,
    name_ar: null,
    price: '12.500',
    commission_rule: { kind: 'FOLLOW_PLAN' },
    counts_toward_threshold: true,
  });
  expect(response.status).toBe(201);
  return service.parse(response.body);
}

it('closing a service answers the service with a closed mark and the read shows the same mark', async () => {
  const created = await makeService('Closing service');
  expect(created.closed_at).toBeNull();
  const response = await closeService(created.id, { expected_revision: created.revision });
  expect(response.status).toBe(200);
  const closed = service.parse(response.body);
  expect(typeof closed.closed_at).toBe('string');
  expect(closed.revision).toBe(created.revision + 1);
  const read = await readService(created.id);
  expect(read.status).toBe(200);
  expect(read.body['closed_at']).toBe(closed.closed_at);
});

it('closing a service that is already closed is refused with SERVICE_ALREADY_CLOSED', async () => {
  const created = await makeService('Twice closed service');
  const first = await closeService(created.id, { expected_revision: created.revision });
  expect(first.status).toBe(200);
  const again = await closeService(created.id, {
    expected_revision: service.parse(first.body).revision,
  });
  expect(again.status).toBe(409);
  expect(again.body['code']).toBe('SERVICE_ALREADY_CLOSED');
});

it('reopening a service clears the closed mark', async () => {
  const created = await makeService('Reopened service');
  const closed = await closeService(created.id, { expected_revision: created.revision });
  expect(closed.status).toBe(200);
  const response = await reopenService(created.id, {
    expected_revision: service.parse(closed.body).revision,
  });
  expect(response.status).toBe(200);
  const reopened = service.parse(response.body);
  expect(reopened.closed_at).toBeNull();
  expect(reopened.revision).toBe(created.revision + 2);
});

it('reopening a service that is not closed is refused with SERVICE_NOT_CLOSED', async () => {
  const created = await makeService('Never closed service');
  const refused = await reopenService(created.id, { expected_revision: created.revision });
  expect(refused.status).toBe(409);
  expect(refused.body['code']).toBe('SERVICE_NOT_CLOSED');
});

it('a caller who may read the services but not close them is refused on close and on reopen', async () => {
  const created = await makeService('Refused closing service');
  const reader = await readOnlyMember(f);
  const refusedClose = await closeService(
    created.id,
    { expected_revision: created.revision },
    reader.cookie,
  );
  expect(refusedClose.status).toBe(403);
  expect(refusedClose.body['code']).toBe('FORBIDDEN');
  const refusedReopen = await reopenService(
    created.id,
    { expected_revision: created.revision },
    reader.cookie,
  );
  expect(refusedReopen.status).toBe(403);
  expect(refusedReopen.body['code']).toBe('FORBIDDEN');
  const read = await readService(created.id);
  expect(read.status).toBe(200);
  expect(read.body['closed_at']).toBeNull();
});
