import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  clearImportedRefunds,
  packageRefundFixture,
  postRefund,
  readRefundAudits,
  readRefunds,
  readSaleEvents,
  refundBody,
  seedSoldPackage,
  setImportedRefunds,
  type PackageRefundFixture,
} from './package-refund.fixture.ts';

let fx: PackageRefundFixture;

beforeAll(async () => {
  fx = await packageRefundFixture();
});

afterAll(async () => {
  await fx?.f.close();
});

it('RF-08 refuses an imported package while the switch is off and refunds it once the switch is on', async () => {
  const { f, imported } = fx;
  const body = refundBody({ component_id: imported.component, sessions: 1 });
  await clearImportedRefunds(f);
  expect(await postRefund(f, imported.entitlement, { body })).toMatchObject({
    status: 422,
    body: { code: 'IMPORTED_REFUND_DISABLED' },
  });
  expect(await readRefunds(f, imported.entitlement)).toHaveLength(0);
  await setImportedRefunds(f, false);
  expect(await postRefund(f, imported.entitlement, { body })).toMatchObject({
    status: 422,
    body: { code: 'IMPORTED_REFUND_DISABLED' },
  });
  expect(await readRefunds(f, imported.entitlement)).toHaveLength(0);
  await setImportedRefunds(f, true);
  const accepted = await postRefund(f, imported.entitlement, { body });
  expect(accepted.status).toBe(201);
  expect(accepted.body).toMatchObject({ amount: '2.250', refunded_amount: '2.250', revision: 2 });
  expect(await readRefunds(f, imported.entitlement)).toHaveLength(1);
  expect(await readRefundAudits(f, imported.entitlement)).toHaveLength(1);
  expect(await readSaleEvents(f, imported.entitlement)).toHaveLength(0);
});

it('RF-08 leaves a sold refund untouched by the imported switch', async () => {
  const { f } = fx;
  await setImportedRefunds(f, false);
  const fresh = await seedSoldPackage(f);
  const response = await postRefund(f, fresh.entitlement, {
    body: refundBody({ component_id: fresh.component, sessions: 1 }),
  });
  expect(response.status).toBe(201);
  expect(await readRefunds(f, fresh.entitlement)).toHaveLength(1);
});

it('RF-09 refunds a zero-value package with an amount of zero and one more revision', async () => {
  const { f } = fx;
  const zero = await seedSoldPackage(f, { sessions: 2, unit: '0.000' });
  const response = await postRefund(f, zero.entitlement, {
    body: refundBody({ component_id: zero.component, sessions: 1 }),
  });
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({
    amount: '0.000',
    refunded_amount: '0.000',
    revision: 2,
  });
  const refunds = await readRefunds(f, zero.entitlement);
  expect(refunds).toHaveLength(1);
  expect(refunds[0]).toMatchObject({ amount: '0.000', sessions: 1, entitlement_revision: 2 });
});
