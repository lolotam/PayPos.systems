import { afterAll, beforeAll, expect, it } from 'vitest';
import { OWNER_ROLE_ID, type TenantWrappers } from '@pospay/db';
import { packageSaleTransactions } from '../persistence/package-sale.transactions.ts';
import {
  ExecutePackageSale,
  PackageSaleRetryError,
} from '../use-cases/execute-package-sale/execute-package-sale.ts';
import { packageSaleFixture, type PackageSaleFixture } from './package-sale.fixture.ts';

let f: PackageSaleFixture;

beforeAll(async () => {
  f = await packageSaleFixture();
});
afterAll(async () => {
  if (f) await f.close();
});

const RECORDED_AT = '2026-11-05T12:00:00.000Z';

const blowDry = () =>
  f.seedType({ price: '25.000', validityDays: 90, components: [{ sessions: 10, price: '3.000' }] });

/** عامل بيع مبني على database مختلف، عشان الاختبار يتحكم في فشل الاتصال نفسه. */
function workerOn(database: Pick<TenantWrappers, 'withTenant'>): ExecutePackageSale {
  return new ExecutePackageSale(
    packageSaleTransactions(database, f.ids, { timeoutMs: 30_000 }),
    f.ids,
    f.clock,
  );
}

it('writes nothing when a completed request is executed again (SA-09)', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type });
  await f.worker().execute(f.company, requestId);
  const completed = await f.state(requestId);
  const before = await f.counts();
  await expect(f.worker().execute(f.company, requestId)).resolves.toBeUndefined();
  expect(await f.state(requestId)).toEqual(completed);
  expect(await f.counts()).toEqual(before);
});

it('writes nothing when a failed request is executed again (SA-09)', async () => {
  const type = await blowDry();
  const seller = await f.sellerWith({ deleted: true });
  const requestId = await f.request({ type, seller_employee_id: seller });
  await f.worker().execute(f.company, requestId);
  const failed = await f.state(requestId);
  expect(failed.status).toBe('failed');
  const before = await f.counts();
  await expect(f.worker().execute(f.company, requestId)).resolves.toBeUndefined();
  expect(await f.state(requestId)).toEqual(failed);
  expect(await f.counts()).toEqual(before);
});

it('lets only one of two concurrent deliveries sell the same pending request', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type });
  await Promise.all([
    f.worker().execute(f.company, requestId),
    f.worker().execute(f.company, requestId),
  ]);
  const state = await f.state(requestId);
  expect(state.status).toBe('completed');
  const sold = await f.sold(requestId);
  expect(sold.entitlements).toHaveLength(1);
  expect(sold.audit).toHaveLength(1);
  expect(sold.events).toHaveLength(1);
  expect(sold.components).toHaveLength(1);
  expect(sold.slots).toHaveLength(10);
}, 60_000);

it('retries a lost commit acknowledgement and never fails the completed request', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type });
  const lossy: Pick<TenantWrappers, 'withTenant'> = {
    withTenant: async (companyId, work, options) => {
      await f.database.withTenant(companyId, work, options);
      throw new Error('PACKAGE_SALE_COMMIT_ACK_LOST');
    },
  };
  await expect(workerOn(lossy).execute(f.company, requestId)).rejects.toThrow(PackageSaleRetryError);
  const afterLoss = await f.state(requestId);
  expect(afterLoss.status).toBe('completed');
  const before = await f.counts();
  await expect(f.worker().execute(f.company, requestId)).resolves.toBeUndefined();
  expect(await f.state(requestId)).toEqual(afterLoss);
  expect(await f.counts()).toEqual(before);
});

it('keeps the request pending when the transaction fails for an unknown reason', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type });
  const before = await f.counts();
  const broken: Pick<TenantWrappers, 'withTenant'> = {
    withTenant: async () => {
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    },
  };
  await expect(workerOn(broken).execute(f.company, requestId)).rejects.toThrow(PackageSaleRetryError);
  const state = await f.state(requestId);
  expect(state.status).toBe('pending');
  expect(state.error_code).toBeNull();
  expect(state.finished_at).toBeNull();
  expect(await f.counts()).toEqual(before);
});

it('sells under the frozen limit and the recorded day after the recorder lost access', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, price_paid: '22.500', discount_limit_bps: 1000 });
  // مالك تاني للشركة عشان انتهاء عضوية المسجّلة ما يخالفش حارس "لازم يفضل مالك".
  const secondOwner = f.ids.newId();
  await f.owner`INSERT INTO "user"(id,name,email)
    VALUES(${secondOwner},'Synthetic second owner','second-owner@example.test')`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES(${f.company},${f.ids.newId()},${secondOwner},${OWNER_ROLE_ID},'global','COMPANY',${f.company})`;
  await f.owner`UPDATE memberships SET starts_at=now() - interval '2 days', ends_at=now() - interval '1 day',
    limit_bps=0 WHERE id=${f.membership} AND company_id=${f.company}`;
  f.clock.setNow(new Date('2026-12-01T00:00:00Z'));
  try {
    await f.worker().execute(f.company, requestId);
  } finally {
    f.clock.setNow(new Date(RECORDED_AT));
  }
  const state = await f.state(requestId);
  expect(state.status).toBe('completed');
  expect(state.discount_limit_bps).toBe(1000);
  const sold = await f.sold(requestId);
  expect(sold.entitlements[0]).toMatchObject({
    discount: '2.500',
    discount_bps: 1000,
    sold_business_date: '2026-11-05',
    expires_on: '2027-02-03',
  });
  expect(sold.entitlements[0]?.sold_at.toISOString()).toBe(RECORDED_AT);
});

it('closes a pending request with PACKAGE_SALE_FAILED and leaves a completed one alone', async () => {
  const type = await blowDry();
  const pendingId = await f.request({ type });
  await f.worker().fail(f.company, pendingId, 'PACKAGE_SALE_FAILED');
  const failed = await f.state(pendingId);
  expect(failed.status).toBe('failed');
  expect(failed.error_code).toBe('PACKAGE_SALE_FAILED');
  expect(failed.finished_at?.toISOString()).toBe(RECORDED_AT);
  const completedId = await f.request({ type });
  await f.worker().execute(f.company, completedId);
  const completed = await f.state(completedId);
  await f.worker().fail(f.company, completedId, 'PACKAGE_SALE_FAILED');
  expect(await f.state(completedId)).toEqual(completed);
});
