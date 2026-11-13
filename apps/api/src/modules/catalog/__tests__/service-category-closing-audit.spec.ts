import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { serviceRecordFromRow } from '../domain/service-row.ts';
import { serviceSnapshot } from '../domain/service.ts';
import {
  grantCategories,
  namesFor,
  serviceCategoriesFixture,
  type ServiceCategoryFixture,
} from './service-categories.fixture.ts';

/** صف الخدمة كما تخرج من القاعدة، بنفس أعمدة serviceRecordFromRow. */
interface ServiceRow {
  readonly id: string;
  readonly business_id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: string;
  readonly commission_rule_kind: string;
  readonly commission_pct_bps: number | null;
  readonly commission_fixed_amount: string | null;
  readonly counts_toward_threshold: boolean;
  readonly duration_minutes: number | null;
  readonly category_id: string | null;
  readonly closed_at: Date | string | null;
  readonly closed_by_category_id: string | null;
  readonly revision: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

/** صف تدقيق خدمة: قبل وبعد نسخة التدقيق نفسها اللي بتتكتب في القاعدة. */
interface ServiceAuditRow {
  readonly id: string;
  readonly actor_user_id: string | null;
  readonly entity_id: string;
  readonly action: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

const AT = '2026-10-05T10:00:00Z';
// وقت بجزء تحت الألف جزء: القاعدة بتخزّنه بالميكروثانية، والـ domain بيقراه Date بثلاث خانات بس.
const AT_SUB_MILLISECOND = '2026-10-05T10:00:00.1234567Z';
const OPEN_SERVICES = 5;
// حالة العمولة الفارغة (PCT من غير نسبة، وFIXED من غير مبلغ) مش قابلة للاختبار: القاعدة بترفضها
// بنفس الـ CHECK بتاع services_rule_pct_present وservices_rule_fixed_present، فالصف ده ما بيوجدش.
// وده مضمون إن فرع COALESCE في جملة التدقيق مالوش حالة واصلة.

/** الحالتان اللي الكاسكاد بيتدقق فيهما، بترتيب الإغلاق ثم الفتح. */
const CASCADE_CASES = [
  { action: 'closed', countKey: 'services_closed' },
  { action: 'reopened', countKey: 'services_reopened' },
] as const;

let f: ServiceCategoryFixture;
let categoryId = '';
const serviceIds: string[] = [];
const closedAloneId = randomUUID();
let subMillisecondId = '';

const createCategory = (body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const closeCategory = (body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories/${categoryId}/close`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const reopenCategory = (body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories/${categoryId}/reopen`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });

/** الخدمات من جدول الخدمات مباشرة: النسخة اللي لازم يساويها تدقيق الكاسكاد. */
const readServices = async (): Promise<ServiceRow[]> =>
  await f.h.owner<ServiceRow[]>`SELECT id,business_id,name_en,name_ar,price,commission_rule_kind,
    commission_pct_bps,commission_fixed_amount,counts_toward_threshold,duration_minutes,category_id,
    closed_at,closed_by_category_id,revision,created_at,updated_at
    FROM services WHERE company_id=${f.company} AND business_id=${f.business}
      AND category_id=${categoryId} ORDER BY id`;

/** تدقيق الخدمات للعملية المطلوبة، مرتّب بمعرّف الخدمة. */
const readServiceAudits = async (action: string): Promise<ServiceAuditRow[]> =>
  await f.h.owner<ServiceAuditRow[]>`SELECT id,actor_user_id,entity_id,action,before,after
    FROM audit_log WHERE company_id=${f.company} AND entity='service' AND action=${action}
      AND entity_id IN (SELECT id FROM services WHERE company_id=${f.company}
        AND business_id=${f.business} AND category_id=${categoryId})
      ORDER BY entity_id`;

/** نسخة التدقيق من سجل الخدمة كما بتبنيه دالة النطاق، من غير قيم undefined. */
const snapshotsOf = (rows: readonly ServiceRow[]): Map<string, Record<string, unknown>> =>
  new Map(
    rows.map((row) => [
      row.id,
      JSON.parse(JSON.stringify(serviceSnapshot(serviceRecordFromRow(row)))) as Record<
        string,
        unknown
      >,
    ]),
  );

/** نسخة التصنيف الحالية من القاعدة: كل حالة تقرأ نسختها لحالها فمفيش نسخة مشتركة تتغير. */
const readCategoryRevision = async (): Promise<number> => {
  const [row] = await f.h.owner`SELECT revision FROM service_categories
    WHERE company_id=${f.company} AND business_id=${f.business} AND id=${categoryId}`;
  return Number(row?.['revision'] ?? 0);
};

/** يفحص حالة كاسكاد واحدة: التدقيق بسطر الخدمة قبل وبعد، والخدمة المقفولة لوحدها ما بتتلمسش. */
const auditCascade = async (
  action: 'closed' | 'reopened',
  countKey: 'services_closed' | 'services_reopened',
): Promise<void> => {
  const before = snapshotsOf(await readServices());
  const revision = await readCategoryRevision();
  const response =
    action === 'closed'
      ? await closeCategory({ expected_revision: revision, expected_service_count: OPEN_SERVICES })
      : await reopenCategory({ expected_revision: revision, expected_service_count: OPEN_SERVICES });
  expect(response.status).toBe(200);
  expect(response.body[countKey]).toBe(OPEN_SERVICES);
  const after = snapshotsOf(await readServices());

  const audits = await readServiceAudits(action);
  expect(audits).toHaveLength(OPEN_SERVICES);
  expect(audits.map((audit) => audit.entity_id).toSorted()).toEqual(serviceIds.toSorted());
  expect(audits.map((audit) => audit.entity_id)).not.toContain(closedAloneId);
  expect(new Set(audits.map((audit) => audit.id)).size).toBe(OPEN_SERVICES);
  for (const audit of audits) {
    expect(audit.actor_user_id).toBe(f.userId);
    expect(audit.before).toEqual(before.get(audit.entity_id));
    expect(audit.after).toEqual(after.get(audit.entity_id));
  }

  // وقت الإنشاء بجزء تحت الألف جزء: نسخته في التدقيق مقطوعة على المللي ثانية زي ما JavaScript بيقرا.
  const subMillisecondAudit = audits.find((audit) => audit.entity_id === subMillisecondId);
  expect(subMillisecondAudit?.before?.['created_at']).toBe('2026-10-05T10:00:00.123Z');
  expect(subMillisecondAudit?.after?.['created_at']).toBe('2026-10-05T10:00:00.123Z');
  if (action === 'closed') {
    // وقت التحديث بجزء تحت الألف جزء برضه، وده وقت الإغلاق الأول فبيفضل زي ما اتخزّن.
    expect(subMillisecondAudit?.before?.['updated_at']).toBe('2026-10-05T10:00:00.123Z');
  }

  const categoryAudits = await f.h.owner`SELECT id,actor_user_id FROM audit_log
    WHERE company_id=${f.company} AND entity='service_category' AND entity_id=${categoryId}
      AND action=${action}`;
  expect(categoryAudits).toHaveLength(1);
  expect(categoryAudits[0]?.['actor_user_id']).toBe(f.userId);

  const untouched = (await readServices()).find((row) => row.id === closedAloneId);
  expect(untouched?.closed_at).toEqual(new Date(AT));
};

beforeAll(async () => {
  f = await serviceCategoriesFixture();
  await grantCategories(f, f.business, 'manage:service-categories:business');
  await grantCategories(f, f.business, 'read:service-categories:business');
  const created = await createCategory(namesFor('Audit equivalence category'));
  expect(created.status).toBe(201);
  categoryId = created.body['id'] as string;
  const [pct, fixed, zero, plan] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  subMillisecondId = randomUUID();
  serviceIds.push(pct, fixed, zero, plan, subMillisecondId);
  // خمس خدمات مفتوحة بأنواع عمولة مختلفة، وواحدة مقفولة من قبل: الأخيرة ما بتتلمسش.
  // الخدمة الخامسة وقتها بجزء تحت الألف جزء، فالتدقيق لازم يقراها مقطوعة زي ما JavaScript بيقراها.
  await f.h.owner`INSERT INTO services
    (company_id,id,business_id,name_en,name_ar,price,commission_rule_kind,commission_pct_bps,
      commission_fixed_amount,counts_toward_threshold,duration_minutes,category_id,revision,
      created_at,updated_at)
    VALUES
      (${f.company},${pct},${f.business},'Percentage service','خدمة بنسبة',12.500,'PCT',250,NULL,
        true,30,${categoryId},1,${AT},${AT}),
      (${f.company},${fixed},${f.business},'Fixed service',NULL,7.000,'FIXED',NULL,1.250,
        false,NULL,${categoryId},1,${AT},${AT}),
      (${f.company},${zero},${f.business},'Zero service',NULL,0.000,'ZERO',NULL,NULL,
        true,15,${categoryId},1,${AT},${AT}),
      (${f.company},${plan},${f.business},'Plan service',NULL,5.250,'FOLLOW_PLAN',NULL,NULL,
        true,NULL,${categoryId},1,${AT},${AT}),
      (${f.company},${subMillisecondId},${f.business},'Sub millisecond service',NULL,4.125,'FOLLOW_PLAN',
        NULL,NULL,true,NULL,${categoryId},1,${AT_SUB_MILLISECOND},${AT_SUB_MILLISECOND}),
      (${f.company},${closedAloneId},${f.business},'Closed alone service',NULL,3.750,'FOLLOW_PLAN',
        NULL,NULL,true,NULL,${categoryId},1,${AT},${AT})`;
  await f.h.owner`UPDATE services SET closed_at=${AT} WHERE id=${closedAloneId}`;
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('SCA-01/SCA-02 the close and the reopen each audit every service with the snapshot of its own row', async () => {
  for (const { action, countKey } of CASCADE_CASES) {
    await auditCascade(action, countKey);
  }
});
