import { afterAll, beforeAll, expect, it } from 'vitest';
import { ids } from './session.fixture.ts';
import {
  packageRefundFixture,
  postRefund,
  readRefunds,
  refundBody,
  refundPath,
  seedForeignCompanyPackage,
  seedOtherBusinessPackage,
  seedSoldPackage,
  type PackageRefundFixture,
} from './package-refund.fixture.ts';

let fx: PackageRefundFixture;

beforeAll(async () => {
  fx = await packageRefundFixture();
});

afterAll(async () => {
  await fx?.f.close();
});

it('RF-10 refuses a member without the refund permission and writes nothing', async () => {
  const { f } = fx;
  const fresh = await seedSoldPackage(f);
  const response = await postRefund(f, fresh.entitlement, {
    cookie: fx.outsider,
    body: refundBody({ component_id: fresh.component, sessions: 1 }),
  });
  expect(response.status).toBe(403);
  expect(await readRefunds(f, fresh.entitlement)).toHaveLength(0);
});

it('RF-10 refuses a device principal even with a valid body and key', async () => {
  const { f } = fx;
  const fresh = await seedSoldPackage(f);
  const response = await f.h.app.inject({
    method: 'POST',
    url: refundPath(f, fresh.entitlement),
    headers: {
      authorization: `Device ${fx.deviceToken}`,
      'x-company-id': f.company,
      'idempotency-key': ids.newId(),
    },
    payload: refundBody({ component_id: fresh.component, sessions: 1 }),
  });
  expect(response.statusCode).toBe(403);
  expect((response.json() as { code: string }).code).toBe('FORBIDDEN');
  expect(await readRefunds(f, fresh.entitlement)).toHaveLength(0);
});

it('RF-10 refuses the refund while the orders feature is off', async () => {
  const { f } = fx;
  const fresh = await seedSoldPackage(f);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic refund feature',${f.ownerId})`;
  try {
    const response = await postRefund(f, fresh.entitlement, {
      body: refundBody({ component_id: fresh.component, sessions: 1 }),
    });
    expect(response).toMatchObject({ status: 403, body: { code: 'FEATURE_DISABLED' } });
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
  expect(await readRefunds(f, fresh.entitlement)).toHaveLength(0);
});

it('RF-10 answers the same 404 for an unknown, another-business and another-company entitlement', async () => {
  const { f } = fx;
  const unknown = await postRefund(f, ids.newId(), {
    body: refundBody({ component_id: ids.newId(), sessions: 1 }),
  });
  expect(unknown).toMatchObject({ status: 404, body: { code: 'PACKAGE_NOT_FOUND' } });
  const otherBusiness = await seedOtherBusinessPackage(f);
  const business = await postRefund(f, otherBusiness.entitlement, {
    body: refundBody({ component_id: otherBusiness.component, sessions: 1 }),
  });
  expect(business.status).toBe(404);
  expect(business.body).toEqual(unknown.body);
  const foreign = await seedForeignCompanyPackage(f);
  const company = await postRefund(f, foreign.entitlement, {
    body: refundBody({ component_id: foreign.component, sessions: 1 }),
  });
  expect(company.status).toBe(404);
  expect(company.body).toEqual(unknown.body);
});
