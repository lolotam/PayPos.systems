import {
  closeServiceCategoryResult,
  reopenServiceCategoryResult,
  serviceCategory,
} from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  grantCategories,
  namesFor,
  serviceCategoriesFixture,
  type ServiceCategoryFixture,
} from './service-categories.fixture.ts';

/**
 * حجم التصنيف المقاس: 300 خدمة مفتوحة، وهو الحجم اللي «قاعدة الـ 200 مللي» بتقيسه.
 * 300 حدّ أمان اختاره القياس على جهاز مشترك محمّل: عند 300 وصل وسيط الفتح 182 مللي، و500 كسر حد
 * الـ 200 مللي في ربعين من أربع دورات، و400 عدّى في دورتين محليتين بس، ودورتين قليل على أساس قرار.
 * فوق 300 الطلب يفضل متزامن لحد شريحة الـ worker اللي بعدها.
 */
const SERVICE_COUNT = 300;

/** دورات مقاسة بعد دورة التسخين الواحدة؛ الوسيط بيتحسب منهم. */
const MEASURED_CYCLES = 5;

/**
 * التجهيز وحده ليه مهلة واسعة: نسخ الداتابيز والبذر ثلاثمئة خدمة بطيئين، بس ده مش جزء من الميزانية.
 * القياس نفسه بيمشي على مهلة الاختبار الافتراضية، فما فيه مهلة فضفاضة تخفي البطء.
 */
const SEEDING_TIMEOUT_MS = 120_000;

let f: ServiceCategoryFixture;
let categoryId: string;
let revision: number;

const createCategory = (body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const closeCategory = (category: string, body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories/${category}/close`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const reopenCategory = (category: string, body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories/${category}/reopen`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });

/** عدد الخدمات المقفولة في التصنيف بالوقت الحالي؛ الصفر بعد الفتح. */
const closedServiceCount = async (): Promise<number> => {
  const [row] = await f.h.owner`SELECT count(*)::int AS n FROM services
    WHERE company_id=${f.company} AND business_id=${f.business} AND category_id=${categoryId}
      AND closed_at IS NOT NULL`;
  return Number(row?.['n'] ?? 0);
};

/** عدد صفوف التدقيق لكيان وعملية؛ الفرق بين قبل وبعد العملية هو عدد صفوف العملية نفسها. */
const auditCount = async (entity: string, action: string): Promise<number> => {
  const [row] = await f.h.owner`SELECT count(*)::int AS n FROM audit_log
    WHERE company_id=${f.company} AND entity=${entity} AND action=${action}`;
  return Number(row?.['n'] ?? 0);
};

/** الوسيط: العنصر الأوسط بعد الترتيب؛ خمس عينات معناها الثالث. */
const median = (samples: readonly number[]): number => {
  const sorted = [...samples].toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Infinity;
};

/**
 * ثلاثمئة خدمة مفتوحة في التصنيف، بجملة واحدة على مقبض الـ owner: ثلاثمئة نداء API هياكلوا الميزانية
 * قبل القياس ويكرّروا الشغل اللي بنقيسه. الأسماء مختلفة لكل خدمة عشان تبقى صفوف مستقلة.
 */
const seedServices = async (): Promise<void> => {
  await f.h.owner`INSERT INTO services
    (company_id,id,business_id,name_en,name_ar,price,commission_rule_kind,counts_toward_threshold,
      category_id,revision)
    SELECT ${f.company}, gen_random_uuid(), ${f.business}, 'Budget service ' || gs.n, NULL,
      12.500, 'FOLLOW_PLAN', true, ${categoryId}, 1
    FROM generate_series(1, ${SERVICE_COUNT}::int) AS gs(n)`;
  // إحصاءات الجدول بتخلّي المخطط يختار خطة زي ما الجدول بحجمه الحقيقي بيختار: من غيرها
  // القياس ممكن يقيس خطة بحث مش هتاخدها القاعدة في الإنتاج.
  await f.h.owner`ANALYZE services`;
};

/**
 * دورة كاملة: إغلاق ثم فتح. الزمن بيتقاس على نداء الـ HTTP نفسه، وفحص الأثر فوقه: العدد اللي
 * رجع، والصفوف المقفولة، وصفوف التدقيق. الفحص خارج زمن النداء، فما بيزوّدش القياس.
 */
const cycle = async (): Promise<{ closeMs: number; reopenMs: number }> => {
  const closedServicesBefore = await auditCount('service', 'closed');
  const closedCategoryBefore = await auditCount('service_category', 'closed');
  const closeStarted = performance.now();
  const closed = await closeCategory(categoryId, {
    expected_revision: revision,
    expected_service_count: SERVICE_COUNT,
  });
  const closeMs = performance.now() - closeStarted;
  expect(closed.status).toBe(200);
  const closedResult = closeServiceCategoryResult.parse(closed.body);
  expect(closedResult.services_closed).toBe(SERVICE_COUNT);
  revision = closedResult.revision;
  expect(await closedServiceCount()).toBe(SERVICE_COUNT);
  expect(await auditCount('service', 'closed')).toBe(closedServicesBefore + SERVICE_COUNT);
  expect(await auditCount('service_category', 'closed')).toBe(closedCategoryBefore + 1);

  const reopenedServicesBefore = await auditCount('service', 'reopened');
  const reopenedCategoryBefore = await auditCount('service_category', 'reopened');
  const reopenStarted = performance.now();
  const reopened = await reopenCategory(categoryId, {
    expected_revision: revision,
    expected_service_count: SERVICE_COUNT,
  });
  const reopenMs = performance.now() - reopenStarted;
  expect(reopened.status).toBe(200);
  const reopenedResult = reopenServiceCategoryResult.parse(reopened.body);
  expect(reopenedResult.services_reopened).toBe(SERVICE_COUNT);
  revision = reopenedResult.revision;
  expect(await closedServiceCount()).toBe(0);
  expect(await auditCount('service', 'reopened')).toBe(reopenedServicesBefore + SERVICE_COUNT);
  expect(await auditCount('service_category', 'reopened')).toBe(reopenedCategoryBefore + 1);
  return { closeMs, reopenMs };
};

beforeAll(async () => {
  f = await serviceCategoriesFixture();
  await grantCategories(f, f.business, 'manage:service-categories:business');
  await grantCategories(f, f.business, 'read:service-categories:business');
  const created = await createCategory(namesFor('Budget cascade category'));
  expect(created.status).toBe(201);
  const category = serviceCategory.parse(created.body);
  categoryId = category.id;
  revision = category.revision;
  await seedServices();
  const [row] = await f.h.owner`SELECT count(*)::int AS n FROM services
    WHERE company_id=${f.company} AND category_id=${categoryId}`;
  expect(Number(row?.['n'] ?? 0)).toBe(SERVICE_COUNT);
  expect(await closedServiceCount()).toBe(0);
}, SEEDING_TIMEOUT_MS);

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('a warm close and reopen of 300 services each answer under the 200 ms budget', async () => {
  // دورة التسخين: القياس يبدأ من حالة دافئة، زي ما «قاعدة الـ 200 مللي» بتطلب.
  await cycle();
  const closeTimes: number[] = [];
  const reopenTimes: number[] = [];
  for (let round = 0; round < MEASURED_CYCLES; round++) {
    const times = await cycle();
    closeTimes.push(times.closeMs);
    reopenTimes.push(times.reopenMs);
  }
  const closeMedian = median(closeTimes);
  const reopenMedian = median(reopenTimes);
  process.stdout.write(
    `SERVICE_CATEGORY_CASCADE_WARM ${JSON.stringify({
      close_ms: closeTimes,
      reopen_ms: reopenTimes,
      close_median_ms: closeMedian,
      reopen_median_ms: reopenMedian,
    })}\n`,
  );
  // الحد المطلق بتاع CLAUDE.md §6؛ مش نسبة مقارنة بالقديم، والحد ما بيتحسبش من أي قياس.
  expect(closeMedian).toBeLessThan(200);
  expect(reopenMedian).toBeLessThan(200);
});
