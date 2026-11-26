import { packageTypeDetail } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { readPackageTypeForSale } from '../persistence/package-type-sale.reader.ts';
import {
  packageTypesFixture,
  packageTerms,
  grantPackages,
  type PackageFixture,
} from './package-types.fixture.ts';

const ids = systemUuidV7();
let f: PackageFixture;

beforeAll(async () => {
  f = await packageTypesFixture();
  await grantPackages(f);
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const req = (m: 'GET' | 'POST' | 'PATCH', p: string, body?: object, b = f.business) =>
  f.h.send(m, `/v1/businesses/${b}/package-types${p}`, {
    cookie: f.cookie,
    company: f.company,
    ...(body ? { body } : {}),
  });

const post = (body: object, b = f.business) => req('POST', '', body, b);
const get = (id: string, b = f.business) => req('GET', `/${id}`, undefined, b);
const list = (b = f.business) => req('GET', '', undefined, b);
const patch = (id: string, body: object, b = f.business) => req('PATCH', `/${id}`, body, b);
const stop = (id: string, body: object, b = f.business) =>
  req('POST', `/${id}/stop-selling`, body, b);
const resume = (id: string, body: object, b = f.business) =>
  req('POST', `/${id}/resume-selling`, body, b);

it('ST-01 stops and resumes with audits, refusing no-op and stale revisions', async () => {
  const created = (await post(packageTerms(f, 'ST-01 Package'))).body;
  const id = created['id'] as string;
  expect(created['revision']).toBe(1);
  expect(created['selling_stopped_at']).toBeNull();

  const stopRes = await stop(id, { expected_revision: 1 });
  expect(stopRes.status).toBe(200);
  const stoppedDetail = packageTypeDetail.parse(stopRes.body);
  expect(stoppedDetail.revision).toBe(2);
  expect(stoppedDetail.selling_stopped_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  const stoppedAt = stoppedDetail.selling_stopped_at;

  const [stopAudit] = await f.h.owner`SELECT action, before, after FROM audit_log
    WHERE entity='package_type' AND entity_id=${id} AND action='selling_stopped'`;
  expect(stopAudit?.['before']).toEqual({ selling_stopped_at: null, revision: 1 });
  expect(stopAudit?.['after']).toEqual({ selling_stopped_at: stoppedAt, revision: 2 });

  const resumeRes = await resume(id, { expected_revision: 2 });
  expect(resumeRes.status).toBe(200);
  const resumedDetail = packageTypeDetail.parse(resumeRes.body);
  expect(resumedDetail.revision).toBe(3);
  expect(resumedDetail.selling_stopped_at).toBeNull();

  const [resumeAudit] = await f.h.owner`SELECT action, before, after FROM audit_log
    WHERE entity='package_type' AND entity_id=${id} AND action='selling_resumed'`;
  expect(resumeAudit?.['before']).toEqual({ selling_stopped_at: stoppedAt, revision: 2 });
  expect(resumeAudit?.['after']).toEqual({ selling_stopped_at: null, revision: 3 });

  const rowState = () =>
    f.h.owner`SELECT revision, selling_stopped_at FROM package_types WHERE id=${id}`;
  const auditCount = () => f.h.owner`SELECT count(*) FROM audit_log WHERE entity_id=${id}`;

  const auditsBeforeResume = await auditCount();
  const stateBeforeResume = await rowState();
  const resumeActiveRes = await resume(id, { expected_revision: 3 });
  expect(resumeActiveRes.status).toBe(409);
  expect(resumeActiveRes.body['code']).toBe('PACKAGE_TYPE_SELLING_UNCHANGED');
  expect(await auditCount()).toEqual(auditsBeforeResume);
  expect(await rowState()).toEqual(stateBeforeResume);

  const stopAgainRes = await stop(id, { expected_revision: 3 });
  expect(stopAgainRes.status).toBe(200);
  expect(stopAgainRes.body['revision']).toBe(4);

  const auditsBeforeStop = await auditCount();
  const stateBeforeStop = await rowState();
  const stopStoppedRes = await stop(id, { expected_revision: 4 });
  expect(stopStoppedRes.status).toBe(409);
  expect(stopStoppedRes.body['code']).toBe('PACKAGE_TYPE_SELLING_UNCHANGED');
  expect(await auditCount()).toEqual(auditsBeforeStop);
  expect(await rowState()).toEqual(stateBeforeStop);

  const staleStopRes = await stop(id, { expected_revision: 1 });
  expect(staleStopRes.status).toBe(409);
  expect(staleStopRes.body['code']).toBe('PACKAGE_TYPE_REVISION_CONFLICT');
  expect(await auditCount()).toEqual(auditsBeforeStop);
  expect(await rowState()).toEqual(stateBeforeStop);
});

it(
  'ST-02 list and detail reflect selling_stopped_at after stop and null after resume',
  async () => {
    const created = (await post(packageTerms(f, 'ST-02 Package'))).body;
    const id = created['id'] as string;

    const stopRes = await stop(id, { expected_revision: 1 });
    expect(stopRes.status).toBe(200);
    const stoppedAt = stopRes.body['selling_stopped_at'] as string;
    expect(stoppedAt).toBeTruthy();

    expect((await get(id)).body['selling_stopped_at']).toBe(stoppedAt);
    const listStopped = (await list()).body['items'] as Array<Record<string, unknown>>;
    expect(listStopped.find((item) => item['id'] === id)?.['selling_stopped_at']).toBe(stoppedAt);

    const resumeRes = await resume(id, { expected_revision: 2 });
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body['selling_stopped_at']).toBeNull();

    expect((await get(id)).body['selling_stopped_at']).toBeNull();
    const listResumed = (await list()).body['items'] as Array<Record<string, unknown>>;
    expect(listResumed.find((item) => item['id'] === id)?.['selling_stopped_at']).toBeNull();
  },
);

it(
  'ST-03 a stopped type stays editable and its components are untouched by stop and resume',
  async () => {
    const created = (await post(packageTerms(f, 'ST-03 Package'))).body;
    const id = created['id'] as string;
    const getComponents = () =>
      f.h.owner`SELECT service_id, sessions, position FROM package_type_components
        WHERE package_type_id=${id} ORDER BY position`;
    const initialComponents = await getComponents();

    const stopRes = await stop(id, { expected_revision: 1 });
    expect(stopRes.status).toBe(200);
    const stoppedAt = stopRes.body['selling_stopped_at'];
    expect(stoppedAt).toBeTruthy();
    expect(await getComponents()).toEqual(initialComponents);

    const resumeRes = await resume(id, { expected_revision: 2 });
    expect(resumeRes.status).toBe(200);
    expect(await getComponents()).toEqual(initialComponents);

    const stopAgain = await stop(id, { expected_revision: 3 });
    expect(stopAgain.status).toBe(200);
    const reStoppedAt = stopAgain.body['selling_stopped_at'];

    const editBody = {
      ...packageTerms(f, 'ST-03 Package Edited'),
      expected_revision: 4,
      price: '35.000',
    };
    const patchRes = await patch(id, editBody);
    expect(patchRes.status).toBe(200);
    const edited = packageTypeDetail.parse(patchRes.body);
    expect(edited.price).toBe('35.000');
    expect(edited.revision).toBe(5);
    expect(edited.selling_stopped_at).toBe(reStoppedAt);

    const detail = (await get(id)).body;
    expect(detail['selling_stopped_at']).toBe(reStoppedAt);
    expect(detail['price']).toBe('35.000');
    expect(detail['revision']).toBe(5);
  },
);

it(
  'ST-04 enforces permissions, catalog feature flag, and 404 for missing or foreign ids',
  async () => {
    const created = (await post(packageTerms(f, 'ST-04 Package'))).body;
    const id = created['id'] as string;

    const denyId = ids.newId();
    await f.h.owner`INSERT INTO permission_overrides
      (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES (${f.company},${denyId},${f.memberId},'manage:package-types:business',
        'DENY','BUSINESS',${f.business},'Denied',${f.userId})`;
    try {
      expect((await stop(id, { expected_revision: 1 })).status).toBe(403);
      expect((await resume(id, { expected_revision: 1 })).status).toBe(403);
    } finally {
      await f.h.owner`DELETE FROM permission_overrides WHERE id=${denyId}`;
    }

    await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
      VALUES (${f.company},'catalog',false,'Synthetic disabled',${f.userId})`;
    try {
      const featureStop = await stop(id, { expected_revision: 1 });
      expect(featureStop.status).toBe(403);
      expect(featureStop.body['code']).toBe('FEATURE_DISABLED');
      const featureResume = await resume(id, { expected_revision: 1 });
      expect(featureResume.status).toBe(403);
      expect(featureResume.body['code']).toBe('FEATURE_DISABLED');
    } finally {
      await f.h.owner`DELETE FROM company_feature_overrides
        WHERE company_id=${f.company} AND flag='catalog'`;
    }

    const unknownId = ids.newId();
    const unknownStop = await stop(unknownId, { expected_revision: 1 });
    expect(unknownStop.status).toBe(404);
    expect(unknownStop.body['code']).toBe('PACKAGE_TYPE_NOT_FOUND');
    const unknownResume = await resume(unknownId, { expected_revision: 1 });
    expect(unknownResume.status).toBe(404);
    expect(unknownResume.body['code']).toBe('PACKAGE_TYPE_NOT_FOUND');

    const service = await f.create.execute({
      companyId: f.company,
      businessId: f.secondBusiness,
      userId: f.userId,
      input: { name_en: 'Foreign service', price: '0.000', commission_rule: { kind: 'ZERO' } },
    });
    const foreign = await f.createPackage.execute({
      companyId: f.company,
      businessId: f.secondBusiness,
      userId: f.userId,
      input: {
        ...packageTerms(f, 'Foreign Business Package'),
        components: [{ service_id: service.id, sessions: 1 }],
      },
    });
    const foreignStop = await stop(foreign.id, { expected_revision: 1 }, f.business);
    expect(foreignStop.status).toBe(404);
    expect(foreignStop.body['code']).toBe('PACKAGE_TYPE_NOT_FOUND');
    const foreignResume = await resume(foreign.id, { expected_revision: 1 }, f.business);
    expect(foreignResume.status).toBe(404);
    expect(foreignResume.body['code']).toBe('PACKAGE_TYPE_NOT_FOUND');

    expect(
      await f.h.owner`SELECT 1 FROM audit_log WHERE entity='package_type'
        AND entity_id IN (${foreign.id}, ${id}) AND action LIKE 'selling_%'`,
    ).toHaveLength(0);
  },
);

const waitForPackageTypeLockWaiter = async () => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await f.h.owner`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query ILIKE '%package_types%'
        AND query ILIKE '%FOR UPDATE%'`;
    if ((row?.['n'] as number) >= 1) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
};

it(
  'ST-03b serializes with catalog sale reader FOR SHARE so stop waits for sale commit',
  async () => {
    const created = (await post(packageTerms(f, 'ST-03b Package'))).body;
    const packageTypeId = created['id'] as string;

    let saleReadFinished!: () => void;
    const saleReadPromise = new Promise<void>((resolve) => {
      saleReadFinished = resolve;
    });
    let releaseSale!: () => void;
    const saleBlocker = new Promise<void>((resolve) => {
      releaseSale = resolve;
    });
    let saleReadSellingStoppedAt: string | null | undefined;
    let stopCompleted = false;

    const saleTransaction = f.db.withTenant(f.company, async (tx) => {
      const saleType = await readPackageTypeForSale(tx, f.company, f.business, packageTypeId);
      saleReadSellingStoppedAt = saleType?.selling_stopped_at;
      saleReadFinished();
      await saleBlocker;
    });

    await saleReadPromise;

    const stopPromise = stop(packageTypeId, { expected_revision: 1 }).then((res) => {
      stopCompleted = true;
      return res;
    });

    try {
      const locked = await waitForPackageTypeLockWaiter();
      expect(locked).toBe(true);
      expect(stopCompleted).toBe(false);
    } finally {
      releaseSale();
      await saleTransaction;
      await stopPromise.catch(() => undefined);
    }

    const stopResponse = await stopPromise;
    expect(stopResponse.status).toBe(200);
    expect(stopCompleted).toBe(true);
    expect(saleReadSellingStoppedAt).toBeNull();
    expect(stopResponse.body['selling_stopped_at']).not.toBeNull();
  },
);

async function closedServicePackage(name: string) {
  const service = await f.create.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: { name_en: `${name} service`, price: '8.000', commission_rule: { kind: 'ZERO' } },
  });
  const created = (
    await post({ ...packageTerms(f, name), components: [{ service_id: service.id, sessions: 2 }] })
  ).body;
  return { id: created['id'] as string, serviceId: service.id };
}

it('ST-05 refuses resume for a closed component with no write, but stop, detail and list still work (SI-Q28)', async () => {
  const { id, serviceId } = await closedServicePackage('ST-05 Package');
  const stopped = (await stop(id, { expected_revision: 1 })).body;
  await f.h
    .owner`UPDATE services SET closed_at=now() WHERE company_id=${f.company} AND id=${serviceId}`;
  const auditBefore = await f.h.owner`SELECT count(*) FROM audit_log`;
  const refused = await resume(id, { expected_revision: stopped['revision'] });
  expect(refused.status).toBe(400);
  expect(refused.body['code']).toBe('PACKAGE_TYPE_SERVICE_NOT_FOUND');
  expect(await f.h.owner`SELECT count(*) FROM audit_log`).toEqual(auditBefore);
  const [row] = await f.h
    .owner`SELECT revision, selling_stopped_at FROM package_types WHERE id=${id}`;
  expect(row?.['revision']).toBe(stopped['revision']);
  expect(row?.['selling_stopped_at']).not.toBeNull();
  expect((await get(id)).status).toBe(200);
  expect(((await list()).body['items'] as { id: string }[]).some((item) => item.id === id)).toBe(
    true,
  );
});

it('ST-06 still stops a package on sale after its component service is closed (SI-Q28)', async () => {
  const { id, serviceId } = await closedServicePackage('ST-06 Package');
  await f.h
    .owner`UPDATE services SET closed_at=now() WHERE company_id=${f.company} AND id=${serviceId}`;
  const response = await stop(id, { expected_revision: 1 });
  expect(response.status).toBe(200);
  expect(response.body['selling_stopped_at']).not.toBeNull();
});

it('ST-07 refuses create and update that pick a closed service, and resumes once it is reopened (SI-Q28)', async () => {
  const { id, serviceId } = await closedServicePackage('ST-07 Package');
  const stopped = (await stop(id, { expected_revision: 1 })).body;
  await f.h
    .owner`UPDATE services SET closed_at=now() WHERE company_id=${f.company} AND id=${serviceId}`;
  const closedTerms = {
    ...packageTerms(f, 'ST-07 New'),
    components: [{ service_id: serviceId, sessions: 1 }],
  };
  const created = await post(closedTerms);
  expect([created.status, created.body['code']]).toEqual([400, 'PACKAGE_TYPE_SERVICE_NOT_FOUND']);
  const edited = await patch(id, { ...closedTerms, expected_revision: stopped['revision'] });
  expect([edited.status, edited.body['code']]).toEqual([400, 'PACKAGE_TYPE_SERVICE_NOT_FOUND']);
  await f.h
    .owner`UPDATE services SET closed_at=NULL WHERE company_id=${f.company} AND id=${serviceId}`;
  expect((await resume(id, { expected_revision: stopped['revision'] })).status).toBe(200);
});
