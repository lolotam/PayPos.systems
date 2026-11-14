import { appendAuditLogs, serviceCategoryCascadeStatement } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  serviceCategoryClosingFixture,
  type ServiceCategoryClosingFixture,
} from './service-category-closing.fixture.ts';

let f: ServiceCategoryClosingFixture;

const SERVICES = 1000;
const ROUNDS = 5;
const AT = '2026-11-14T10:00:00.000Z';

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted[Math.floor(sorted.length / 2)];
  if (middle === undefined) throw new Error('the measurement has no samples');
  return middle;
};

// خط الأساس هو مسار الإغلاق المتزامن في الـ API كما هو: نفس الأقفال ونفس الجمل بنفس الترتيب
// بيعكس apps/api/src/modules/catalog/use-cases/close-service-category/close-service-category.usecase.ts؛
// أي تغيير هناك لازم يتنقل هنا (persistence/drizzle-service-category-transactions.ts وclosing.ts).
// الـ worker ما ينفعش يستورد كود الـ API، فالجمل منسوخة هنا بدل حالة الاستخدام نفسها.
const baseline = async (
  fixture: ServiceCategoryClosingFixture,
  categoryId: string,
): Promise<void> => {
  const { company, business } = fixture;
  await fixture.db.withTenant(
    company,
    async (tx) => {
      const [category] = await tx.execute<{ revision: number }>(sql`SELECT id,business_id,name_en,
        name_ar,owner_branch_id,visibility,closed_at,revision,created_at,updated_at
        FROM service_categories
        WHERE company_id=${company} AND business_id=${business} AND id=${categoryId} FOR UPDATE`);
      if (category === undefined) throw new Error('the baseline category is missing');
      const services = await tx.execute<{ id: string }>(sql`SELECT id,business_id,name_en,name_ar,
        price,commission_rule_kind,commission_pct_bps,commission_fixed_amount,
        counts_toward_threshold,duration_minutes,category_id,closed_at,closed_by_category_id,
        revision,created_at,updated_at FROM services
        WHERE company_id=${company} AND business_id=${business} AND category_id=${categoryId}
          AND closed_at IS NULL ORDER BY id FOR NO KEY UPDATE`);
      await tx.execute(sql`UPDATE service_categories
        SET closed_at=${AT}::timestamptz,updated_at=${AT}::timestamptz,revision=${category.revision + 1}
        WHERE company_id=${company} AND business_id=${business} AND id=${categoryId}
          AND revision=${category.revision} RETURNING id`);
      await tx.execute(
        serviceCategoryCascadeStatement({
          companyId: company,
          businessId: business,
          categoryId,
          closing: true,
          at: AT,
          auditIds: JSON.stringify(
            services.map((service) => ({ service_id: service.id, audit_id: fixture.ids.newId() })),
          ),
          expectedCount: services.length,
        }),
      );
      await appendAuditLogs(tx, [
        {
          id: fixture.ids.newId(),
          entry: {
            entity: 'service_category',
            entityId: categoryId,
            action: 'closed',
            before: { closed_at: null, revision: category.revision },
            after: { closed_at: AT, revision: category.revision + 1 },
          },
        },
      ]);
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

const timeJob = async (): Promise<number> => {
  const category = await f.category({ open: SERVICES });
  const closingId = await f.closing(category, { action: 'close' });
  const start = performance.now();
  const outcome = await f.useCase.execute(f.company, closingId);
  const elapsed = performance.now() - start;
  // زمن طلب فشل مالوش معنى في المقارنة، فلازم يكون قفل الألف خدمة فعلاً
  expect(outcome).toEqual({ kind: 'completed', servicesChanged: SERVICES });
  return elapsed;
};

const timeBaseline = async (): Promise<number> => {
  const category = await f.category({ open: SERVICES });
  const start = performance.now();
  await baseline(f, category.categoryId);
  return performance.now() - start;
};

it('runs a thousand services within twice the unchanged sync close of the same run', async () => {
  const jobTimes: number[] = [];
  const baselineTimes: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    // الترتيب بيتبادل كل جولة، عشان سخونة الكاش ما تميلش لطرف واحد
    const jobFirst = round % 2 === 0;
    const first = jobFirst ? await timeJob() : await timeBaseline();
    const second = jobFirst ? await timeBaseline() : await timeJob();
    if (round === 0) continue;
    jobTimes.push(jobFirst ? first : second);
    baselineTimes.push(jobFirst ? second : first);
  }

  expect(median(jobTimes)).toBeLessThanOrEqual(2 * median(baselineTimes) + 5);
});
