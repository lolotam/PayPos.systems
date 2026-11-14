import postgres from 'postgres';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';

import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { serviceCategoryClosingTransactions } from '../persistence/service-category-closing.transactions.ts';
import { RunServiceCategoryClosing } from '../use-cases/run-service-category-closing/run-service-category-closing.ts';

const NOW = new Date('2026-11-14T10:00:00.000Z');
const REQUESTED_AT = new Date('2026-11-14T09:59:00.000Z');
const DEADLINE_AT = new Date('2026-11-14T10:15:00.000Z');
const SEEDED_AT = '2026-11-14T08:00:00.000Z';

/** تصنيف مبذور: خدماته المفتوحة والمعلّمة والمقفولة منفردة ونسخته. */
export interface SeededCategory {
  readonly categoryId: string;
  readonly businessId: string;
  readonly revision: number;
  readonly openServiceIds: readonly string[];
  readonly markedServiceIds: readonly string[];
  readonly closedAloneServiceIds: readonly string[];
}

/** خدمات التصنيف المراد بذرها: مفتوحة، أو معلّمة بالتصنيف، أو مقفولة منفردة. */
export interface CategoryInput {
  readonly open?: number;
  readonly marked?: number;
  readonly closedAlone?: number;
  readonly closed?: boolean;
}

/** طلب القفل أو الفتح المراد بذره فوق التصنيف. */
export interface ClosingInput {
  readonly action: 'close' | 'reopen';
  readonly expectedRevision?: number;
  readonly expectedServiceCount?: number;
  readonly deadlineAt?: Date;
}

interface FixtureContext {
  readonly owner: postgres.Sql;
  readonly ids: ReturnType<typeof systemUuidV7>;
  readonly company: string;
  readonly business: string;
}

/** حالة الخدمة المراد بذرها: وقت الإغلاق وعلامة التصنيف بيتحددوا مع بعض. */
interface ServiceState {
  readonly closedAt: string | null;
  readonly marker: string | null;
}

/** يزرع خدمات التصنيف بحالة واحدة. */
async function seedServices(
  context: FixtureContext,
  categoryId: string,
  count: number,
  state: ServiceState,
): Promise<string[]> {
  if (count === 0) return [];
  const rows = await context.owner`INSERT INTO services
    (company_id,id,business_id,name_en,price,commission_rule_kind,counts_toward_threshold,category_id,
      closed_at,closed_by_category_id,revision,created_at,updated_at)
    SELECT ${context.company},gen_random_uuid(),${context.business},'Closing worker service ' || g,
      '10.000','FOLLOW_PLAN',true,${categoryId},${state.closedAt}::timestamptz,${state.marker}::uuid,1,
      ${SEEDED_AT},${SEEDED_AT}
    FROM generate_series(1, ${count}) g
    RETURNING id`;
  return rows.map((row) => row['id'] as string);
}

/** يزرع تصنيفاً وخدماته؛ التصنيف المقفول بيتقفل بنفس النسخة عشان يبقى الفحص على الحالة وحدها. */
async function seedCategory(
  context: FixtureContext,
  input: CategoryInput,
): Promise<SeededCategory> {
  const categoryId = context.ids.newId();
  await context.owner`INSERT INTO service_categories
    (company_id,id,business_id,name_en,name_ar,visibility,revision,created_at,updated_at)
    VALUES (${context.company},${categoryId},${context.business},
      ${'Closing worker category ' + categoryId},'تصنيف العامل','BUSINESS',1,${SEEDED_AT},${SEEDED_AT})`;
  const openServiceIds = await seedServices(context, categoryId, input.open ?? 0, {
    closedAt: null,
    marker: null,
  });
  const markedServiceIds = await seedServices(context, categoryId, input.marked ?? 0, {
    closedAt: SEEDED_AT,
    marker: categoryId,
  });
  const closedAloneServiceIds = await seedServices(context, categoryId, input.closedAlone ?? 0, {
    closedAt: SEEDED_AT,
    marker: null,
  });
  if (input.closed === true)
    await context.owner`UPDATE service_categories SET closed_at=${SEEDED_AT}::timestamptz
      WHERE id=${categoryId}`;
  return {
    categoryId,
    businessId: context.business,
    revision: 1,
    openServiceIds,
    markedServiceIds,
    closedAloneServiceIds,
  };
}

/** يزرع طلب قفل أو فتح معلق فوق التصنيف؛ العدد المتوقع بيتحسب من خدمات التصنيف نفسها. */
async function seedClosing(
  context: FixtureContext,
  category: SeededCategory,
  input: ClosingInput,
): Promise<string> {
  const closingId = context.ids.newId();
  const expectedCount =
    input.expectedServiceCount ??
    (input.action === 'close' ? category.openServiceIds.length : category.markedServiceIds.length);
  await context.owner`INSERT INTO service_category_closings
    (company_id,id,business_id,category_id,action,status,expected_revision,expected_service_count,
      requested_by,requested_at,deadline_at)
    VALUES (${context.company},${closingId},${category.businessId},${category.categoryId},
      ${input.action},'pending',${input.expectedRevision ?? category.revision},${expectedCount},
      ${USER},${REQUESTED_AT},${input.deadlineAt ?? DEADLINE_AT})`;
  return closingId;
}

/** ساعة الاختبار: تقرأ لحظة الطلب، والاختبار يقدر يغيّرها وهو شغّال. */
export interface MutableClock {
  now(): Date;
  set(at: Date): void;
}

/** يبني ساعة تبدأ من لحظة معيّنة وبتعديلها الاختبار وقت ما يحب. */
export function mutableClock(start: Date): MutableClock {
  let current = start;
  return {
    now: () => current,
    set: (at: Date) => {
      current = at;
    },
  };
}

/** وعد بحلّه متاح من برّه: الاختبار هو اللي يقرر وقت الفك. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * يمسك قفل التصنيف من معاملة تانية: الاختبار يعدّل الساعة وهو القفل ماسك، وبعدين يفكه
 * فتبقى المعاملة اللي بتشغّل الطلب واقفة ورا القفل.
 */
async function holdCategoryLock(
  owner: postgres.Sql,
  companyId: string,
  categoryId: string,
): Promise<{ release: () => Promise<void> }> {
  const released = deferred();
  const acquired = deferred();
  const holder = owner.begin(async (tx) => {
    await tx`SELECT id FROM service_categories
      WHERE company_id=${companyId} AND id=${categoryId} FOR UPDATE`;
    acquired.resolve();
    await released.promise;
  });
  await acquired.promise;
  let done = false;
  return {
    release: async () => {
      if (done) return;
      done = true;
      released.resolve();
      await holder;
    },
  };
}

/** قاعدة مستقلة للعامل؛ صف الطلب هو بديل المنتج لحد ما يجي مفتاح الـ API. */
export async function serviceCategoryClosingFixture() {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 6, onnotice: () => undefined });
  const ids = systemUuidV7();
  const db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    VALUES (${USER},'Closing worker user','closing-worker@example.test',true,now(),now())
    ON CONFLICT DO NOTHING`;
  const context: FixtureContext = {
    owner,
    ids,
    company: TENANT.A.company,
    business: TENANT.A.business,
  };
  const transactions = serviceCategoryClosingTransactions(db, ids, 60_000, 5_000);
  const useCase = new RunServiceCategoryClosing(transactions, { now: () => NOW });

  return {
    db,
    owner,
    ids,
    useCase,
    company: TENANT.A.company,
    business: TENANT.A.business,
    otherCompany: TENANT.B.company,
    otherBusiness: TENANT.B.business,
    userId: USER,
    clock: { now: () => NOW },
    useCaseWithClock: (clock: MutableClock) => new RunServiceCategoryClosing(transactions, clock),
    holdCategoryLock: (categoryId: string) => holdCategoryLock(owner, context.company, categoryId),
    category: (input: CategoryInput = {}) => seedCategory(context, input),
    closing: (category: SeededCategory, input: ClosingInput) =>
      seedClosing(context, category, input),
    closingRow: async (closingId: string) => {
      const [row] = await owner`SELECT status,services_changed,error_code,finished_at
        FROM service_category_closings WHERE id=${closingId}`;
      return row;
    },
    categoryRow: async (categoryId: string) => {
      const [row] =
        await owner`SELECT revision,closed_at FROM service_categories WHERE id=${categoryId}`;
      return row;
    },
    serviceRows: async (categoryId: string) =>
      await owner`SELECT id,closed_at,closed_by_category_id,revision FROM services
        WHERE company_id=${context.company} AND category_id=${categoryId} ORDER BY id`,
    auditRows: async (categoryId: string) =>
      await owner`SELECT entity,entity_id,action,actor_user_id FROM audit_log
        WHERE company_id=${context.company}
          AND ((entity='service_category' AND entity_id=${categoryId})
            OR (entity='service' AND entity_id IN
              (SELECT id FROM services WHERE company_id=${context.company} AND category_id=${categoryId})))
        ORDER BY entity,entity_id`,
    async close() {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}

export type ServiceCategoryClosingFixture = Awaited<
  ReturnType<typeof serviceCategoryClosingFixture>
>;
