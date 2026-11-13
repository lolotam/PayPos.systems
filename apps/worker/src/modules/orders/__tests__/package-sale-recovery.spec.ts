import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';
import {
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { packageSaleRecoveryTransactions } from '../persistence/package-sale-recovery.transactions.ts';
import { RecoverPackageSales } from '../use-cases/recover-package-sales/recover-package-sales.ts';
import { packageSaleFixture, type PackageSaleFixture } from './package-sale.fixture.ts';

let f: PackageSaleFixture;

beforeAll(async () => {
  f = await packageSaleFixture();
});
afterAll(async () => {
  if (f) await f.close();
});

// ساعة العامل في الـ fixture هي 2026-11-05T12:00:00Z؛ السجلات دي بالقياس عليها.
const STALE = '2026-11-05T11:40:00Z';
const BOUNDARY = '2026-11-05T11:50:00Z';
const YOUNG = '2026-11-05T11:55:00Z';
const NOW = '2026-11-05T12:00:00.000Z';

function sweep() {
  return new RecoverPackageSales(packageSaleRecoveryTransactions(f.database), f.clock);
}

async function seedType() {
  return f.seedType({
    price: '25.000',
    validityDays: 90,
    components: [{ sessions: 1, price: '25.000' }],
  });
}

/** ينتظر ظهور متسنى حقيقي على صف الطلب؛ الاعتماد على حالة القفل مش على زمن.sleep. */
async function waitForBlockedRow(): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt++) {
    const [row] = await f.owner<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_locks
      WHERE NOT granted AND pid <> pg_backend_pid()`;
    if ((row?.waiting ?? 0) >= 1) return;
    await delay(25);
  }
  throw new Error('PACKAGE_SALE_RECOVERY_NO_WAITER');
}

/** طلب معلّق لشركة تانية؛ لازم يفضل زي ما هو بعد مسح الشركة الأولى. */
async function insertOtherCompanyRequest(): Promise<string> {
  const id = f.ids.newId();
  await f.owner`INSERT INTO package_sale_requests(company_id,id,business_id,branch_id,recorded_by,
    recorded_by_membership_id,discount_limit_bps,customer_id,package_type_id,expected_type_revision,
    expected_service_revisions,price_paid,paid_method,seller_employee_id,sold_at,recorded_at,status)
    VALUES(${TENANT.B.company},${id},${TENANT.B.business},${TENANT.B.branch},${USER},${ORDER_IDS.membership},
      1000,${ORDER_IDS.customer},${f.ids.newId()},1,
      ${f.owner.json([{ service_id: ORDER_IDS.service, revision: 1 }])},'25.000','CASH',
      ${ORDER_IDS.employee},null,${STALE},'pending')`;
  return id;
}

it('closes a pending request older than ten minutes with PACKAGE_SALE_FAILED', async () => {
  const type = await seedType();
  const requestId = await f.request({ type, recorded_at: STALE });
  await sweep().execute(f.company);
  const state = await f.state(requestId);
  expect(state.status).toBe('failed');
  expect(state.error_code).toBe('PACKAGE_SALE_FAILED');
  expect(state.error_details).toBeNull();
  expect(state.finished_at?.toISOString()).toBe(NOW);
});

it('closes a request pending for exactly ten minutes', async () => {
  const type = await seedType();
  const requestId = await f.request({ type, recorded_at: BOUNDARY });
  await sweep().execute(f.company);
  expect((await f.state(requestId)).status).toBe('failed');
});

it('ignores a request younger than ten minutes', async () => {
  const type = await seedType();
  const requestId = await f.request({ type, recorded_at: YOUNG });
  await sweep().execute(f.company);
  const state = await f.state(requestId);
  expect(state.status).toBe('pending');
  expect(state.error_code).toBeNull();
});

it('ignores a completed request and a failed one even when they are old', async () => {
  const type = await seedType();
  const completedId = await f.request({ type, recorded_at: STALE });
  await f.worker().execute(f.company, completedId);
  const failedId = await f.request({ type, recorded_at: STALE });
  await f.worker().fail(f.company, failedId, 'PACKAGE_SALE_FAILED');
  const completed = await f.state(completedId);
  await sweep().execute(f.company);
  expect(await f.state(completedId)).toEqual(completed);
  expect((await f.state(failedId)).status).toBe('failed');
});

it('closes more than fifty stale requests across reads', async () => {
  const type = await seedType();
  const ids: string[] = [];
  for (let index = 0; index < 55; index++)
    ids.push(await f.request({ type, customer_id: f.customer, recorded_at: STALE }));
  await sweep().execute(f.company);
  const rows = await f.owner`SELECT status FROM package_sale_requests WHERE id = ANY(${ids}::uuid[])`;
  expect(rows).toHaveLength(55);
  expect(rows.every((row) => row['status'] === 'failed')).toBe(true);
});

it('never touches another company request', async () => {
  const type = await seedType();
  const ownId = await f.request({ type, recorded_at: STALE });
  const otherId = await insertOtherCompanyRequest();
  await sweep().execute(f.company);
  const [own] = await f.owner`SELECT status FROM package_sale_requests WHERE id=${ownId}`;
  const [other] = await f.owner`SELECT status FROM package_sale_requests WHERE id=${otherId}`;
  expect(own?.['status']).toBe('failed');
  expect(other?.['status']).toBe('pending');
});

it('waits for an in-flight sale and matches nothing', async () => {
  const type = await seedType();
  const soldId = await f.request({ type });
  await f.worker().execute(f.company, soldId);
  const entitlementId = (await f.state(soldId)).entitlement_id;
  const requestId = await f.request({ type, recorded_at: STALE });
  let release = (): void => undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holding = f.owner.begin(async (tx) => {
    await tx`SELECT id FROM package_sale_requests
      WHERE company_id=${f.company} AND id=${requestId} FOR UPDATE`;
    await blocked;
    await tx`UPDATE package_sale_requests SET status='completed',entitlement_id=${entitlementId},
      finished_at=${'2026-11-05T12:00:00Z'} WHERE company_id=${f.company} AND id=${requestId}`;
  });
  const sweeping = sweep().execute(f.company);
  await waitForBlockedRow();
  release();
  await holding;
  await sweeping;
  const state = await f.state(requestId);
  expect(state.status).toBe('completed');
  expect(state.error_code).toBeNull();
  expect(state.finished_at?.toISOString()).toBe(NOW);
});

it('writes nothing when the job runs after the sweep closed the request', async () => {
  const type = await seedType();
  const requestId = await f.request({ type, recorded_at: STALE });
  await sweep().execute(f.company);
  const failed = await f.state(requestId);
  const before = await f.counts();
  await expect(f.worker().execute(f.company, requestId)).resolves.toBeUndefined();
  expect(await f.state(requestId)).toEqual(failed);
  expect(await f.counts()).toEqual(before);
});
