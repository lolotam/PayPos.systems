import { acceptedPackageSale } from '@pospay/contracts';
import type { ExecutionContext } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { ApiError } from '../../../shared/errors.ts';
import { PackageSalesController } from '../http/package-sales.controller.ts';
import { SessionAdminGuard } from '../http/session-access.guard.ts';
import {
  cleanPackageSales,
  packageSaleRequestFixture,
  postSale,
  readSaleOutbox,
  readSaleRequests,
  saleBody,
} from './package-sale-request.fixture.ts';
import { ids, must, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;

beforeAll(async () => {
  f = (await packageSaleRequestFixture()).f;
});

afterAll(async () => {
  await f?.close();
});

beforeEach(async () => {
  await cleanPackageSales(f);
});

it.each(['BANK_TRANSFER', 'missing'])(
  'SA-06 refuses %s paid_method without storing a request',
  async (paidMethod) => {
    const body = saleBody(f);
    if (paidMethod === 'missing') delete body['paid_method'];
    else body['paid_method'] = paidMethod;
    const response = await postSale(f, { body });
    expect(response).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
    expect(await readSaleRequests(f)).toHaveLength(0);
  },
);

it.each([
  ['expected_type_revision out of bounds', { expected_type_revision: 2147483648 }],
  ['sold_at in year zero', { sold_at: '0000-01-01T00:00:00Z' }],
])('refuses %s with 400 without storing a request', async (_scenario, patch) => {
  const response = await postSale(f, { body: saleBody(f, patch) });
  expect(response).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
  expect(await readSaleRequests(f)).toHaveLength(0);
});

it('accepts one sale with its validated snapshot and one id-only outbox event', async () => {
  const body = saleBody(f);
  const response = await postSale(f, { body });
  expect(response.status).toBe(202);
  const parsed = acceptedPackageSale.parse(response.body);
  const requests = await readSaleRequests(f);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    ...body,
    id: parsed.sale_request_id,
    company_id: f.company,
    business_id: f.business,
    branch_id: f.branch,
    recorded_by: f.userId,
    recorded_by_membership_id: f.membership,
    status: 'pending',
  });
  const events = await readSaleOutbox(f, parsed.sale_request_id);
  expect(events).toHaveLength(1);
  expect(events[0]?.['payload']).toEqual({ sale_request_id: parsed.sale_request_id });
  expect(events[0]).toMatchObject({
    aggregate_type: 'package_sale_request',
    aggregate_id: parsed.sale_request_id,
    event_type: 'PackageSaleRequested',
    payload: { sale_request_id: parsed.sale_request_id },
  });
});

it('SA-09 replays the same acceptance and refuses a changed body under the key', async () => {
  const key = ids.newId();
  const body = saleBody(f);
  const first = await postSale(f, { key, body });
  expect(first.status).toBe(202);
  const accepted = acceptedPackageSale.parse(first.body);
  const replay = await postSale(f, { key, body });
  expect(replay.status).toBe(202);
  expect(acceptedPackageSale.parse(replay.body)).toEqual(accepted);
  expect(await readSaleRequests(f)).toHaveLength(1);
  expect(await readSaleOutbox(f, accepted.sale_request_id)).toHaveLength(1);
  const changed = await postSale(f, {
    key,
    body: saleBody(f, { price_paid: '51.000' }),
  });
  expect(changed).toMatchObject({
    status: 422,
    body: { code: 'IDEMPOTENCY_KEY_REUSED' },
  });
  expect(await readSaleRequests(f)).toHaveLength(1);
  expect(await readSaleOutbox(f, accepted.sale_request_id)).toHaveLength(1);
});

it.each(['missing permission', 'disabled orders'])(
  'SA-11 refuses %s without storing a request',
  async (scenario) => {
    const response = await refusedSale(scenario);
    expect(response.status).toBe(403);
    expect(await readSaleRequests(f)).toHaveLength(0);
  },
);

// جلسة الجهاز الحقيقية تحتاج Redis؛ نثبت أن الحارس نفسه يرفض أي مبدأ ليس مستخدماً.
it('SA-11 refuses a device principal at the route guard', () => {
  const context = (kind: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ principal: { kind } }) }),
    }) as unknown as ExecutionContext;
  expect(() => new SessionAdminGuard().canActivate(context('device'))).toThrow(ApiError);
  expect(new SessionAdminGuard().canActivate(context('user'))).toBe(true);
  const guards: unknown[] =
    Reflect.getMetadata('__guards__', PackageSalesController.prototype.accept) ?? [];
  expect(guards).toContain(SessionAdminGuard);
});

it('freezes the configured member discount limit on the accepted row', async () => {
  await f.h.owner`UPDATE memberships SET limit_bps=1750
    WHERE company_id=${f.company} AND id=${f.membership}`;
  try {
    const response = await postSale(f);
    expect(response.status).toBe(202);
    await f.h.owner`UPDATE memberships SET limit_bps=2500
      WHERE company_id=${f.company} AND id=${f.membership}`;
    const requests = await readSaleRequests(f);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.['discount_limit_bps']).toBe(1750);
  } finally {
    await f.h.owner`UPDATE memberships SET limit_bps=1000
      WHERE company_id=${f.company} AND id=${f.membership}`;
  }
});

it('freezes an unlimited owner discount as NULL on the accepted row', async () => {
  const response = await postSale(f, { cookie: f.ownerCookie });
  expect(response.status).toBe(202);
  const requests = await readSaleRequests(f);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    recorded_by: f.ownerId,
    discount_limit_bps: null,
  });
});

it('refuses a membership of another company as the recorder without a row in either tenant', async () => {
  const [foreign] = await f.h.owner`SELECT id FROM memberships
    WHERE company_id=${f.otherCompany} AND user_id=${f.userId} AND scope_type='COMPANY'`;
  const response = await postSale(f, {
    body: saleBody(f, { recorder_membership_id: must(foreign)['id'] }),
  });
  expect(response.status).toBe(403);
  expect(await readSaleRequests(f)).toHaveLength(0);
  expect(await readSaleRequests(f, f.otherCompany)).toHaveLength(0);
});

it('refuses another business of the same company with the branch with 403', async () => {
  const response = await postSale(f, {
    businessId: f.secondBusiness,
    branchId: f.branch,
    cookie: f.ownerCookie,
  });
  expect(response.status).toBe(403);
  expect(await readSaleRequests(f)).toHaveLength(0);
});

it('SA-10 completes one HTTP acceptance in under 200 ms', async () => {
  const started = performance.now();
  const response = await postSale(f);
  const elapsed = performance.now() - started;
  expect(response.status).toBe(202);
  expect(elapsed).toBeLessThan(200);
});

async function refusedSale(scenario: string) {
  if (scenario === 'missing permission') {
    const cookie = await f.h.signedInOperator('no-package-sale@example.test');
    return postSale(f, { cookie });
  }
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic package sale feature',${f.ownerId})`;
  try {
    return await postSale(f);
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides
      WHERE company_id=${f.company} AND flag='orders'`;
  }
}
