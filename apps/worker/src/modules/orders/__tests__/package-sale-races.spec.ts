import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { packageSaleFixture, type PackageSaleFixture } from './package-sale.fixture.ts';

let f: PackageSaleFixture;

beforeAll(async () => {
  f = await packageSaleFixture();
});
afterAll(async () => {
  if (f) await f.close();
});

const blowDry = () =>
  f.seedType({ price: '25.000', validityDays: 90, components: [{ sessions: 10, price: '3.000' }] });

/**
 * ينتظر ظهور متسنى حقيقي على صف الجدول ده؛ الاعتماد على حالة القفل نفسها مش على زمن.sleep.
 */
async function waitForBlockedRow(relation: string, waiters = 1): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt++) {
    // انتظار صف مقفول يظهر كقفل transactionid أو tuple غير ممنوح، فنعد المنتظرين كلهم مش جدول بعينه.
    const [row] = await f.owner<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_locks
      WHERE NOT granted AND pid <> pg_backend_pid()`;
    if ((row?.waiting ?? 0) >= waiters) return;
    await delay(25);
  }
  throw new Error(`PACKAGE_SALE_RACE_NO_WAITER:${relation}`);
}

/** بوابة تفتح المعاملة المحتجزة لحد ما التسابق يخلص، فالمحتجز ما يفضلش مستني الأبد. */
function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
}

it('refuses the sale when the seller deletion commits first (SA-05b)', async () => {
  const type = await blowDry();
  const seller = await f.sellerWith({});
  const requestId = await f.request({ type, seller_employee_id: seller });
  const before = await f.counts();
  let sale: Promise<void> | undefined;
  await f.owner.begin(async (tx) => {
    await tx`SELECT id FROM employees WHERE company_id=${f.company} AND id=${seller} FOR UPDATE`;
    sale = f.worker().execute(f.company, requestId);
    await waitForBlockedRow('employees');
    await tx`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${seller}`;
  });
  await sale;
  const state = await f.state(requestId);
  expect(state.status).toBe('failed');
  expect(state.error_code).toBe('PACKAGE_SELLER_NOT_ELIGIBLE');
  expect(state.entitlement_id).toBeNull();
  expect(await f.counts()).toEqual(before);
}, 60_000);

it('completes the sale with the seller eligible when the deletion waits for it (SA-05b)', async () => {
  const type = await blowDry();
  const seller = await f.sellerWith({});
  const requestId = await f.request({ type, seller_employee_id: seller });
  const pause = gate();
  const locked = gate();
  // قفل صف الفرع بيوقف البيع عند إدخال الاستحقاق، بعد قفل البائعة، فالتسلسل يبان من غير تخمين.
  const holding = f.owner.begin(async (tx) => {
    await tx`SELECT id FROM branches WHERE company_id=${f.company} AND id=${f.branch} FOR UPDATE`;
    locked.open();
    await pause.opened;
  });
  await locked.opened;
  const sale = f.worker().execute(f.company, requestId);
  await waitForBlockedRow('branches');
  const deleting = f.owner.begin(async (tx) => {
    await tx`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${seller}`;
  });
  await waitForBlockedRow('employees', 2);
  pause.open();
  await holding;
  await sale;
  await deleting;
  const state = await f.state(requestId);
  expect(state.status).toBe('completed');
  const sold = await f.sold(requestId);
  expect(sold.entitlements).toHaveLength(1);
  expect(sold.entitlements[0]).toMatchObject({ seller_employee_id: seller, list_price: '25.000' });
}, 60_000);

it('refuses the sale with the current revision when the type edit commits first (SA-08b)', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type });
  const before = await f.counts();
  let sale: Promise<void> | undefined;
  await f.owner.begin(async (tx) => {
    await tx`UPDATE package_types SET price='27.500', revision=2 WHERE id=${type.typeId}`;
    sale = f.worker().execute(f.company, requestId);
    await waitForBlockedRow('package_types');
  });
  await sale;
  const state = await f.state(requestId);
  expect(state.status).toBe('failed');
  expect(state.error_code).toBe('PACKAGE_TYPE_REVISION_CONFLICT');
  expect(state.error_details).toEqual({ current_revision: 2 });
  expect(await f.counts()).toEqual(before);
}, 60_000);

it('completes the sale with the revision-1 snapshot when the type edit waits for it (SA-08b)', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type });
  const pause = gate();
  const locked = gate();
  const holding = f.owner.begin(async (tx) => {
    await tx`SELECT id FROM employees WHERE company_id=${f.company} AND id=${f.seller} FOR UPDATE`;
    locked.open();
    await pause.opened;
  });
  await locked.opened;
  const sale = f.worker().execute(f.company, requestId);
  await waitForBlockedRow('employees');
  const editing = f.owner.begin(async (tx) => {
    await tx`UPDATE package_types SET price='27.500', revision=2 WHERE id=${type.typeId}`;
  });
  await waitForBlockedRow('package_types', 2);
  pause.open();
  await holding;
  await sale;
  await editing;
  const state = await f.state(requestId);
  expect(state.status).toBe('completed');
  const sold = await f.sold(requestId);
  expect(sold.entitlements[0]).toMatchObject({ list_price: '25.000', revision: 1 });
  const [edited] = await f.owner<{ revision: number; price: string }[]>`
    SELECT revision::int, price::text FROM package_types WHERE id=${type.typeId}`;
  expect(edited).toEqual({ revision: 2, price: '27.500' });
}, 60_000);

it('refuses the sale with the current service revisions when the price edit commits first (SA-08c)', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type });
  const serviceId = f.serviceId(type, 0);
  const before = await f.counts();
  let sale: Promise<void> | undefined;
  await f.owner.begin(async (tx) => {
    await tx`UPDATE services SET price='3.500', revision=2 WHERE id=${serviceId}`;
    sale = f.worker().execute(f.company, requestId);
    await waitForBlockedRow('services');
  });
  await sale;
  const state = await f.state(requestId);
  expect(state.status).toBe('failed');
  expect(state.error_code).toBe('PACKAGE_SALE_QUOTE_STALE');
  expect(state.error_details).toEqual({
    current_service_revisions: [{ service_id: serviceId, revision: 2 }],
  });
  expect(await f.counts()).toEqual(before);
}, 60_000);

it('keeps the confirmed service prices when the price edit waits for the sale (SA-08c)', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type });
  const serviceId = f.serviceId(type, 0);
  const pause = gate();
  const locked = gate();
  const holding = f.owner.begin(async (tx) => {
    await tx`SELECT id FROM employees WHERE company_id=${f.company} AND id=${f.seller} FOR UPDATE`;
    locked.open();
    await pause.opened;
  });
  await locked.opened;
  const sale = f.worker().execute(f.company, requestId);
  await waitForBlockedRow('employees');
  const editing = f.owner.begin(async (tx) => {
    await tx`UPDATE services SET price='3.500', revision=2 WHERE id=${serviceId}`;
  });
  await waitForBlockedRow('services', 2);
  pause.open();
  await holding;
  await sale;
  await editing;
  const state = await f.state(requestId);
  expect(state.status).toBe('completed');
  const sold = await f.sold(requestId);
  expect(sold.components[0]).toMatchObject({ list_price_snapshot: '3.000' });
  const [edited] = await f.owner<{ revision: number; price: string }[]>`
    SELECT revision::int, price::text FROM services WHERE id=${serviceId}`;
  expect(edited).toEqual({ revision: 2, price: '3.500' });
}, 60_000);
