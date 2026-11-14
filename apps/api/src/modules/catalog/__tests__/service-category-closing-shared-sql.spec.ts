import { randomUUID } from 'node:crypto';

import {
  applyServiceCategoryClosing,
  lockServiceCategoryCascadeServices,
  serviceCategoryCascadeStatement,
} from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { serviceCategorySnapshot, type ServiceCategoryRecord } from '../domain/service-category.ts';
import {
  serviceCategoriesFixture,
  type ServiceCategoryFixture,
} from './service-categories.fixture.ts';

const SERVICE_AT = '2026-10-05T09:00:00Z';
// وقت التصنيف بجزء تحت الألف جزء: القاعدة بتخزّنه بالميكروثانية، والـ domain بيقراه بثلاث خانات بس.
const CATEGORY_CREATED_AT = '2026-10-05T10:00:00.1234567Z';
const CLOSE_AT = '2026-10-05T11:00:00Z';
const REOPEN_AT = '2026-10-05T12:00:00Z';

const categoryId = randomUUID();
const otherCategoryId = randomUUID();
const openServiceIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const closedAloneId = randomUUID();
const otherServiceId = randomUUID();

/** صف التصنيف كما يخرج من القاعدة؛ نفس أعمدة تحميل التصنيف في طبقة الحفظ. */
type CategoryRow = {
  id: string;
  business_id: string;
  name_en: string;
  name_ar: string;
  owner_branch_id: string | null;
  visibility: 'BUSINESS' | 'BRANCH';
  closed_at: Date | string | null;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
};

/** صف تدقيق: قبل وبعد نسخة التدقيق نفسها اللي بتتكتب في القاعدة. */
interface AuditRow {
  readonly id: string;
  readonly actor_user_id: string | null;
  readonly entity: string;
  readonly entity_id: string;
  readonly action: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

/** نتيجة دورة كاملة: قفل الخدمات، ثم حالة التصنيف، ثم تدقيقه في نفس المعاملة. */
interface Cycle {
  readonly applied: 'applied' | 'revision-conflict';
  readonly before: ServiceCategoryRecord;
  readonly after: ServiceCategoryRecord;
  readonly lockedIds: readonly string[];
}

let f: ServiceCategoryFixture;
let closeCycle: Cycle;
let reopenCycle: Cycle;

/** نفس ربط الصف بالسجل اللي في طبقة الحفظ: الأوقات ISO والنسخة رقم. */
const categoryRecord = (row: CategoryRow): ServiceCategoryRecord => ({
  id: row.id,
  business_id: row.business_id,
  name_en: row.name_en,
  name_ar: row.name_ar,
  owner_branch_id: row.owner_branch_id,
  visibility: row.visibility,
  closed_at: row.closed_at === null ? null : new Date(row.closed_at).toISOString(),
  revision: row.revision,
  created_at: new Date(row.created_at).toISOString(),
  updated_at: new Date(row.updated_at).toISOString(),
});

/** نسخة التدقيق من سجل التصنيف كما بتبنيه دالة النطاق، من غير قيم undefined. */
const snapshotOf = (record: ServiceCategoryRecord): Record<string, unknown> =>
  JSON.parse(JSON.stringify(serviceCategorySnapshot(record))) as Record<string, unknown>;

const readCategoryRow = async (): Promise<CategoryRow> => {
  const [row] = await f.h.owner<
    CategoryRow[]
  >`SELECT id,business_id,name_en,name_ar,owner_branch_id,
    visibility,closed_at,revision,created_at,updated_at FROM service_categories
    WHERE company_id=${f.company} AND business_id=${f.business} AND id=${categoryId}`;
  if (row === undefined) throw new Error('the category row is missing');
  return row;
};

const readCategoryAudits = async (): Promise<AuditRow[]> =>
  await f.h.owner<AuditRow[]>`SELECT id,actor_user_id,entity,entity_id,action,before,after
    FROM audit_log WHERE company_id=${f.company} AND entity='service_category' AND entity_id=${categoryId}
    ORDER BY action`;

const readServiceAudits = async (action: string): Promise<AuditRow[]> =>
  await f.h.owner<AuditRow[]>`SELECT id,actor_user_id,entity,entity_id,action,before,after
    FROM audit_log WHERE company_id=${f.company} AND entity='service' AND action=${action}
      AND entity_id IN (SELECT id FROM services WHERE company_id=${f.company}
        AND business_id=${f.business} AND category_id=${categoryId})
    ORDER BY entity_id`;

/** دورة كاملة: قفل خدمات الكاسكاد، ثم تطبيق حالة التصنيف، ثم جملة الكاسكاد في نفس المعاملة. */
const cycle = async (closing: boolean, at: string): Promise<Cycle> => {
  const before = categoryRecord(await readCategoryRow());
  const result = await f.db.withTenant(
    f.company,
    async (tx) => {
      const lockedIds = await lockServiceCategoryCascadeServices(tx, {
        companyId: f.company,
        businessId: f.business,
        categoryId,
        closing,
      });
      const applied = await applyServiceCategoryClosing(tx, {
        companyId: f.company,
        businessId: f.business,
        categoryId,
        closing,
        at,
        expectedRevision: before.revision,
        categoryAuditId: randomUUID(),
      });
      await tx.execute(
        serviceCategoryCascadeStatement({
          companyId: f.company,
          businessId: f.business,
          categoryId,
          closing,
          at,
          auditIds: JSON.stringify(
            lockedIds.map((serviceId) => ({ service_id: serviceId, audit_id: randomUUID() })),
          ),
          expectedCount: lockedIds.length,
        }),
      );
      return { applied, lockedIds };
    },
    { userId: f.userId },
  );
  const after = categoryRecord(await readCategoryRow());
  return { applied: result.applied, before, after, lockedIds: result.lockedIds };
};

/** التصنيفين والخدمات: أربع مفتوحة في التصنيف، وواحدة مقفولة منفردة، وواحدة في تصنيف تاني. */
const seed = async (): Promise<void> => {
  await f.h.owner`INSERT INTO service_categories
    (company_id,id,business_id,name_en,name_ar,visibility,revision,created_at,updated_at)
    VALUES (${f.company},${categoryId},${f.business},'Shared SQL category','تصنيف مشترك','BUSINESS',1,
      ${CATEGORY_CREATED_AT},${CATEGORY_CREATED_AT}),
      (${f.company},${otherCategoryId},${f.business},'Shared SQL other category','تصنيف مشترك آخر','BUSINESS',1,
      ${CATEGORY_CREATED_AT},${CATEGORY_CREATED_AT})`;
  for (const [index, id] of openServiceIds.entries()) {
    await f.h.owner`INSERT INTO services
      (company_id,id,business_id,name_en,price,commission_rule_kind,counts_toward_threshold,category_id,
        revision,created_at,updated_at)
      VALUES (${f.company},${id},${f.business},${'Open service ' + (index + 1)},'10.000','FOLLOW_PLAN',true,
        ${categoryId},1,${SERVICE_AT},${SERVICE_AT})`;
  }
  await f.h.owner`INSERT INTO services
    (company_id,id,business_id,name_en,price,commission_rule_kind,counts_toward_threshold,category_id,
      closed_at,revision,created_at,updated_at)
    VALUES (${f.company},${closedAloneId},${f.business},'Closed alone service','9.000','FOLLOW_PLAN',true,
      ${categoryId},${SERVICE_AT},1,${SERVICE_AT},${SERVICE_AT})`;
  await f.h.owner`INSERT INTO services
    (company_id,id,business_id,name_en,price,commission_rule_kind,counts_toward_threshold,category_id,
      revision,created_at,updated_at)
    VALUES (${f.company},${otherServiceId},${f.business},'Other category service','8.000','FOLLOW_PLAN',true,
      ${otherCategoryId},1,${SERVICE_AT},${SERVICE_AT})`;
};

beforeAll(async () => {
  f = await serviceCategoriesFixture();
  await seed();
  closeCycle = await cycle(true, CLOSE_AT);
  reopenCycle = await cycle(false, REOPEN_AT);
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('the cascade lock lists the open services of the category, and the marked ones after the close', () => {
  expect(closeCycle.lockedIds).toEqual(openServiceIds.toSorted());
  expect(reopenCycle.lockedIds).toEqual(openServiceIds.toSorted());
  expect(closeCycle.lockedIds).not.toContain(closedAloneId);
  expect(closeCycle.lockedIds).not.toContain(otherServiceId);
});

it('the close and the reopen raise the revision of the category by one and set its closed_at', () => {
  expect(closeCycle.applied).toBe('applied');
  expect(closeCycle.before.revision).toBe(1);
  expect(closeCycle.after.revision).toBe(2);
  expect(closeCycle.after.closed_at).toBe('2026-10-05T11:00:00.000Z');
  expect(closeCycle.after.updated_at).toBe('2026-10-05T11:00:00.000Z');
  expect(reopenCycle.applied).toBe('applied');
  expect(reopenCycle.before.revision).toBe(2);
  expect(reopenCycle.after.revision).toBe(3);
  expect(reopenCycle.after.closed_at).toBeNull();
  expect(reopenCycle.after.updated_at).toBe('2026-10-05T12:00:00.000Z');
});

it('the category audit row of each call is the domain snapshot of the row before and after it', async () => {
  const audits = await readCategoryAudits();
  expect(audits).toHaveLength(2);
  const closed = audits.find((audit) => audit.action === 'closed');
  const reopened = audits.find((audit) => audit.action === 'reopened');
  expect(closed?.actor_user_id).toBe(f.userId);
  expect(reopened?.actor_user_id).toBe(f.userId);
  expect(closed?.before).toEqual(snapshotOf(closeCycle.before));
  expect(closed?.after).toEqual(snapshotOf(closeCycle.after));
  expect(reopened?.before).toEqual(snapshotOf(reopenCycle.before));
  expect(reopened?.after).toEqual(snapshotOf(reopenCycle.after));
  // وقت الإنشاء بجزء تحت الألف جزء: نسخته في التدقيق مقطوعة على المللي ثانية زي ما JavaScript بيقرا.
  expect(closed?.before?.['created_at']).toBe('2026-10-05T10:00:00.123Z');
  expect(reopened?.after?.['created_at']).toBe('2026-10-05T10:00:00.123Z');
});

it('the cascade writes one service audit row per changed service, and the closed alone one is untouched', async () => {
  const closedAudits = await readServiceAudits('closed');
  const reopenedAudits = await readServiceAudits('reopened');
  expect(closedAudits).toHaveLength(openServiceIds.length);
  expect(reopenedAudits).toHaveLength(openServiceIds.length);
  expect(closedAudits.map((audit) => audit.entity_id).toSorted()).toEqual(
    openServiceIds.toSorted(),
  );
  expect(reopenedAudits.map((audit) => audit.entity_id).toSorted()).toEqual(
    openServiceIds.toSorted(),
  );
  expect(closedAudits.every((audit) => audit.actor_user_id === f.userId)).toBe(true);
  expect(reopenedAudits.every((audit) => audit.actor_user_id === f.userId)).toBe(true);
  expect(closedAudits.map((audit) => audit.entity_id)).not.toContain(closedAloneId);
  const [untouched] = await f.h.owner`SELECT closed_at,closed_by_category_id FROM services
    WHERE id=${closedAloneId}`;
  expect(untouched?.['closed_at']).toEqual(new Date(SERVICE_AT));
  expect(untouched?.['closed_by_category_id']).toBeNull();
});

it('a wrong expected revision changes nothing and writes no audit row', async () => {
  const before = await readCategoryRow();
  const auditsBefore = (await readCategoryAudits()).length;
  const applied = await f.db.withTenant(
    f.company,
    (tx) =>
      applyServiceCategoryClosing(tx, {
        companyId: f.company,
        businessId: f.business,
        categoryId,
        closing: true,
        at: CLOSE_AT,
        expectedRevision: before.revision + 1,
        categoryAuditId: randomUUID(),
      }),
    { userId: f.userId },
  );
  expect(applied).toBe('revision-conflict');
  expect(categoryRecord(await readCategoryRow())).toEqual(categoryRecord(before));
  expect((await readCategoryAudits()).length).toBe(auditsBefore);
});
