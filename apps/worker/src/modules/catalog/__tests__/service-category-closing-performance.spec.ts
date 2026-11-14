import {
  applyServiceCategoryClosing,
  lockServiceCategoryCascadeServices,
  serviceCategoryCascadeStatement,
} from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  serviceCategoryClosingFixture,
  type ServiceCategoryClosingFixture,
} from './service-category-closing.fixture.ts';

let f: ServiceCategoryClosingFixture;

const SERVICES = 1000;
const ROUNDS = 4;
const AT = '2026-11-14T10:00:00.000Z';

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted[Math.floor(sorted.length / 2)];
  if (middle === undefined) throw new Error('the measurement has no samples');
  return middle;
};

/** خط الأساس: نفس الجمل المشتركة في معاملة مستأجر واحدة، على بيانات مطابقة للوظيفة. */
const baseline = async (
  fixture: ServiceCategoryClosingFixture,
  categoryId: string,
): Promise<void> => {
  await fixture.db.withTenant(
    fixture.company,
    async (tx) => {
      const serviceIds = await lockServiceCategoryCascadeServices(tx, {
        companyId: fixture.company,
        businessId: fixture.business,
        categoryId,
        closing: true,
      });
      await applyServiceCategoryClosing(tx, {
        companyId: fixture.company,
        businessId: fixture.business,
        categoryId,
        closing: true,
        at: AT,
        expectedRevision: 1,
        categoryAuditId: fixture.ids.newId(),
      });
      await tx.execute(
        serviceCategoryCascadeStatement({
          companyId: fixture.company,
          businessId: fixture.business,
          categoryId,
          closing: true,
          at: AT,
          auditIds: JSON.stringify(
            serviceIds.map((serviceId) => ({
              service_id: serviceId,
              audit_id: fixture.ids.newId(),
            })),
          ),
          expectedCount: serviceIds.length,
        }),
      );
    },
    { userId: fixture.userId },
  );
};

beforeAll(async () => {
  f = await serviceCategoryClosingFixture();
});

afterAll(async () => {
  await f?.close();
});

it('runs a thousand services within twice the baseline of the same run', async () => {
  const jobTimes: number[] = [];
  const baselineTimes: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    const jobCategory = await f.category({ open: SERVICES });
    const closingId = await f.closing(jobCategory, { action: 'close' });
    const jobStart = performance.now();
    await f.useCase.execute(f.company, closingId);
    const jobMs = performance.now() - jobStart;

    const baselineCategory = await f.category({ open: SERVICES });
    const baselineStart = performance.now();
    await baseline(f, baselineCategory.categoryId);
    const baselineMs = performance.now() - baselineStart;

    if (round === 0) continue;
    jobTimes.push(jobMs);
    baselineTimes.push(baselineMs);
  }

  expect(median(jobTimes)).toBeLessThanOrEqual(2 * median(baselineTimes) + 5);
});
