import { afterAll, beforeAll, expect, it } from 'vitest';

import { lockSessionServicesForSale } from '../persistence/session-services-lock.reader.ts';
import {
  serviceCategoryClosingFixture,
  type ServiceCategoryClosingFixture,
} from './service-category-closing.fixture.ts';

let f: ServiceCategoryClosingFixture;

const SALE_SERVICES = 20;

beforeAll(async () => {
  f = await serviceCategoryClosingFixture();
});

afterAll(async () => {
  await f?.close();
});

it.each(['job-first', 'sale-first'] as const)(
  'finishes both sides when the sale locks the same services for share, started %s',
  async (order) => {
    const category = await f.category({ open: SALE_SERVICES });
    const closingId = await f.closing(category, { action: 'close' });
    const job = () => f.useCase.execute(f.company, closingId);
    const sale = () =>
      f.db.withTenant(f.company, async (tx) => {
        const rows = await lockSessionServicesForSale(
          tx,
          f.company,
          f.business,
          category.openServiceIds,
        );
        return rows.length;
      });

    const started = order === 'job-first' ? [job(), sale()] : [sale(), job()];
    const [first, second] = await Promise.all(started);
    const jobOutcome = order === 'job-first' ? first : second;
    const saleCount = order === 'job-first' ? second : first;

    expect(saleCount).toBe(SALE_SERVICES);
    expect(jobOutcome).toEqual({ kind: 'completed', servicesChanged: SALE_SERVICES });
    expect(await f.closingRow(closingId)).toMatchObject({
      status: 'completed',
      services_changed: SALE_SERVICES,
    });
  },
);
