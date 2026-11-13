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
const OPEN_SERVICES = 4;

let f: ServiceCategoryFixture;
let categoryId = '';
let revision = 0;
const serviceIds: string[] = [];
const closedAloneId = randomUUID();

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

beforeAll(async () => {
  f = await serviceCategoriesFixture();
  await grantCategories(f, f.business, 'manage:service-categories:business');
  await grantCategories(f, f.business, 'read:service-categories:business');
  const created = await createCategory(namesFor('Audit equivalence category'));
  expect(created.status).toBe(201);
  categoryId = created.body['id'] as string;
  revision = created.body['revision'] as number;
  const [pct, fixed, zero, plan] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  serviceIds.push(pct, fixed, zero, plan);
  // أربع خدمات مفتوحة بأنواع عمولة مختلفة، وواحدة مقفولة من قبل: الأخيرة ما بتتلمسش.
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
      (${f.company},${closedAloneId},${f.business},'Closed alone service',NULL,3.750,'FOLLOW_PLAN',
        NULL,NULL,true,NULL,${categoryId},1,${AT},${AT})`;
  await f.h.owner`UPDATE services SET closed_at=${AT} WHERE id=${closedAloneId}`;
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('SCA-01 the close cascade audits every service with the snapshot of its own row', async () => {
  const before = snapshotsOf(await readServices());
  const response = await closeCategory({
    expected_revision: revision,
    expected_service_count: OPEN_SERVICES,
  });
  expect(response.status).toBe(200);
  expect(response.body['services_closed']).toBe(OPEN_SERVICES);
  revision = response.body['revision'] as number;
  const after = snapshotsOf(await readServices());

  const audits = await readServiceAudits('closed');
  expect(audits).toHaveLength(OPEN_SERVICES);
  expect(audits.map((audit) => audit.entity_id).toSorted()).toEqual(serviceIds.toSorted());
  expect(audits.map((audit) => audit.entity_id)).not.toContain(closedAloneId);
  expect(new Set(audits.map((audit) => audit.id)).size).toBe(OPEN_SERVICES);
  for (const audit of audits) {
    expect(audit.actor_user_id).toBe(f.userId);
    expect(audit.before).toEqual(before.get(audit.entity_id));
    expect(audit.after).toEqual(after.get(audit.entity_id));
  }

  const categoryAudits = await f.h.owner`SELECT id,actor_user_id FROM audit_log
    WHERE company_id=${f.company} AND entity='service_category' AND entity_id=${categoryId}
      AND action='closed'`;
  expect(categoryAudits).toHaveLength(1);
  expect(categoryAudits[0]?.['actor_user_id']).toBe(f.userId);
});

it('SCA-02 the reopen cascade audits the marked services and leaves the closed one alone', async () => {
  const before = snapshotsOf(await readServices());
  const response = await reopenCategory({
    expected_revision: revision,
    expected_service_count: OPEN_SERVICES,
  });
  expect(response.status).toBe(200);
  expect(response.body['services_reopened']).toBe(OPEN_SERVICES);
  const after = snapshotsOf(await readServices());

  const audits = await readServiceAudits('reopened');
  expect(audits).toHaveLength(OPEN_SERVICES);
  expect(audits.map((audit) => audit.entity_id).toSorted()).toEqual(serviceIds.toSorted());
  expect(audits.map((audit) => audit.entity_id)).not.toContain(closedAloneId);
  expect(new Set(audits.map((audit) => audit.id)).size).toBe(OPEN_SERVICES);
  for (const audit of audits) {
    expect(audit.actor_user_id).toBe(f.userId);
    expect(audit.before).toEqual(before.get(audit.entity_id));
    expect(audit.after).toEqual(after.get(audit.entity_id));
  }

  const categoryAudits = await f.h.owner`SELECT id,actor_user_id FROM audit_log
    WHERE company_id=${f.company} AND entity='service_category' AND entity_id=${categoryId}
      AND action='reopened'`;
  expect(categoryAudits).toHaveLength(1);
  expect(categoryAudits[0]?.['actor_user_id']).toBe(f.userId);

  const untouched = (await readServices()).find((row) => row.id === closedAloneId);
  expect(untouched?.closed_at).toEqual(new Date(AT));
});
