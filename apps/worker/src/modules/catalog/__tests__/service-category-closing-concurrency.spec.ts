import { afterAll, beforeAll, expect, it } from 'vitest';

import { lockSessionServicesForSale } from '../persistence/session-services-lock.reader.ts';
import {
  hold,
  serviceCategoryClosingFixture,
  type ServiceCategoryClosingFixture,
  type SeededCategory,
} from './service-category-closing.fixture.ts';

let f: ServiceCategoryClosingFixture;

const SALE_SERVICES = 20;

beforeAll(async () => {
  f = await serviceCategoryClosingFixture();
});

afterAll(async () => {
  await f?.close();
});

async function seededClose(): Promise<{ category: SeededCategory; closingId: string }> {
  const category = await f.category({ open: SALE_SERVICES });
  const closingId = await f.closing(category, { action: 'close' });
  return { category, closingId };
}

function saleLocks(category: SeededCategory, whileHeld?: () => Promise<void>) {
  return f.db.withTenant(f.company, async (tx) => {
    const rows = await lockSessionServicesForSale(
      tx,
      f.company,
      f.business,
      category.openServiceIds,
    );
    await whileHeld?.();
    return rows.length;
  });
}

async function expectCompleted(closingId: string, outcome: unknown): Promise<void> {
  expect(outcome).toEqual({ kind: 'completed', servicesChanged: SALE_SERVICES });
  expect(await f.closingRow(closingId)).toMatchObject({
    status: 'completed',
    services_changed: SALE_SERVICES,
  });
}

it('waits for a sale that already holds the services for share, then completes', async () => {
  const { category, closingId } = await seededClose();
  let saleCount = 0;
  const sale = await hold(async (whileHeld) => {
    saleCount = await saleLocks(category, whileHeld);
  });

  const job = f.useCase.execute(f.company, closingId);
  await f.waitForLockWaiters(1);
  expect(await f.closingRow(closingId)).toMatchObject({ status: 'pending' });
  await sale.release();

  expect(saleCount).toBe(SALE_SERVICES);
  await expectCompleted(closingId, await job);
});

it('makes a sale wait while the job holds the services, then the sale finishes', async () => {
  const { category, closingId } = await seededClose();
  // الطلب بيقف عند أول إدخال في الـ audit، وده بعد ما يقفل الخدمات بالفعل
  const audit = await f.holdAuditInserts();

  const job = f.useCase.execute(f.company, closingId);
  await f.waitForLockWaiters(1);
  const sale = saleLocks(category);
  await f.waitForLockWaiters(2);
  await audit.release();

  await expectCompleted(closingId, await job);
  expect(await sale).toBe(SALE_SERVICES);
});
