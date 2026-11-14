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

const SYNC_SERVICES = 300;
const JOB_SERVICES = 301;
const ROUNDS = 6;
const SEEDING_TIMEOUT_MS = 120_000;

let f: ServiceCategoryFixture;
let syncCategoryId = '';
let syncRevision = 0;
let jobCategoryId = '';

const createCategory = (body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const closeCategory = (categoryId: string, body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories/${categoryId}/close`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const reopenCategory = (categoryId: string, body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories/${categoryId}/reopen`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });

/** التصنيف بمئتين وثلاثين أو ثلاثمئة وخدمة، بجملة واحدة على مقبض الـ owner. */
const seedServices = async (categoryId: string, count: number): Promise<void> => {
  await f.h.owner`INSERT INTO services
    (company_id,id,business_id,name_en,price,commission_rule_kind,counts_toward_threshold,
      category_id,revision)
    SELECT ${f.company}, gen_random_uuid(), ${f.business}, 'Perf service ' || gs.n,
      12.500, 'FOLLOW_PLAN', true, ${categoryId}, 1
    FROM generate_series(1, ${count}::int) AS gs(n)`;
  await f.h.owner`ANALYZE services`;
};

/**
 * يمسح الطلب المعلّق حتى تكون كل جولة قبولاً جديداً حقيقياً: الطلب المعاد بيعدّي على مسار
 * الحفظ بدل مسار الإنشاء، والقياس المقصود هو القبول نفسه.
 */
const clearPending = async (): Promise<void> => {
  await f.h.owner`DELETE FROM service_category_closings
    WHERE company_id=${f.company} AND category_id=${jobCategoryId}`;
};

const measureAccept = async (): Promise<number> => {
  await clearPending();
  const started = performance.now();
  const response = await closeCategory(jobCategoryId, {
    expected_revision: 1,
    expected_service_count: JOB_SERVICES,
  });
  const elapsed = performance.now() - started;
  expect(response.status).toBe(202);
  return elapsed;
};

const measureSyncClose = async (): Promise<number> => {
  const started = performance.now();
  const closed = await closeCategory(syncCategoryId, {
    expected_revision: syncRevision,
    expected_service_count: SYNC_SERVICES,
  });
  const elapsed = performance.now() - started;
  expect(closed.status).toBe(200);
  syncRevision = closeServiceCategoryResult.parse(closed.body).revision;
  const reopened = await reopenCategory(syncCategoryId, {
    expected_revision: syncRevision,
    expected_service_count: SYNC_SERVICES,
  });
  expect(reopened.status).toBe(200);
  syncRevision = reopenServiceCategoryResult.parse(reopened.body).revision;
  return elapsed;
};

/** أقرب رتبة للـ 95: مع خمس عينات معناها أعظم عينات الجولة المقاسة. */
const p95 = (samples: readonly number[]): number => {
  const sorted = [...samples].toSorted((left, right) => left - right);
  const rank = Math.min(Math.ceil(0.95 * sorted.length), sorted.length);
  return sorted[rank - 1] ?? Infinity;
};

beforeAll(async () => {
  f = await serviceCategoriesFixture();
  await grantCategories(f, f.business, 'manage:service-categories:business');
  await grantCategories(f, f.business, 'read:service-categories:business');
  const sync = await createCategory(namesFor('Perf sync closing category'));
  const job = await createCategory(namesFor('Perf background closing category'));
  expect(sync.status).toBe(201);
  expect(job.status).toBe(201);
  syncCategoryId = sync.body['id'] as string;
  syncRevision = serviceCategory.parse(sync.body).revision;
  jobCategoryId = job.body['id'] as string;
  await seedServices(syncCategoryId, SYNC_SERVICES);
  await seedServices(jobCategoryId, JOB_SERVICES);
}, SEEDING_TIMEOUT_MS);

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('accepts 301 services within twice the unchanged sync close of 300 in the same run', async () => {
  const acceptTimes: number[] = [];
  const syncTimes: number[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    // الترتيب بيتبادل كل جولة، عشان سخونة الكاش ما تميلش لطرف واحد
    const acceptFirst = round % 2 === 0;
    const first = acceptFirst ? await measureAccept() : await measureSyncClose();
    const second = acceptFirst ? await measureSyncClose() : await measureAccept();
    if (round === 0) continue;
    acceptTimes.push(acceptFirst ? first : second);
    syncTimes.push(acceptFirst ? second : first);
  }
  process.stdout.write(
    `SERVICE_CATEGORY_CLOSING_ACCEPT ${JSON.stringify({
      accept_ms: acceptTimes,
      sync_ms: syncTimes,
      accept_p95_ms: p95(acceptTimes),
      sync_p95_ms: p95(syncTimes),
    })}\n`,
  );
  expect(p95(acceptTimes)).toBeLessThanOrEqual(2 * p95(syncTimes) + 5);
});
