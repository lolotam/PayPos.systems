// أدوات التعافي: شركة تانية بطلباتها، وحالة جديدة، وانتظار التعافي على جدولة حقيقية.
import type { Queue } from 'bullmq';

import { TENANT, USER } from '../../../../../packages/db/test/tenancy-fixtures.ts';
import { RATING_CLAIMS_QUEUE } from '../../modules/customers/jobs/rating-claims.processor.ts';
import { everyDay } from './rating-claims.fixture.ts';
import { seedDueRows, seedPlan, type SeedTarget } from './rating-claims-rows.fixture.ts';
import type { RatingClaimsWorld } from './rating-claims-world.types.ts';

/** المنطقة الزمنية في الاختبار، زي الإنتاج. */
const KUWAIT = 'Asia/Kuwait';
/** مواعيد الفرع: كل يوم من العاشرة إلى العاشرة مساءً. */
const TEN_TO_TEN = everyDay([{ opens: '10:00', closes: '22:00' }]);

/** مفتاح حالة شركة في Redis. */
export function stateKeyOf(prefix: string, companyId: string): string {
  return `${prefix}:rating-claims:v1:{${companyId}}:state`;
}

/** معرّف جدولة الشركة، وهو نفسه اسم الطابور مع معرّف الشركة. */
export function schedulerIdOf(companyId: string): string {
  return `${RATING_CLAIMS_QUEUE}-${companyId}`;
}

/**
 * يفتح طلبات التقييم لنشاط الشركة التانية ويضبط مواعيد فرعها.
 *
 * الشركة التانية في الـ fixture من غير مواعيد ولا مفتاح طلبات، فبدون الخطوة دي المطالبة
 * بتلغي الطلب بدل ما تطلبه.
 */
export async function openSecondCompany(world: RatingClaimsWorld): Promise<void> {
  await world.base.owner`UPDATE branches
    SET opening_hours = ${JSON.stringify(TEN_TO_TEN)}::jsonb, timezone = ${KUWAIT}
    WHERE company_id = ${TENANT.B.company} AND id = ${TENANT.B.branch}`;
  await world.base.owner`INSERT INTO rating_settings
      (company_id, id, business_id, requests_enabled, updated_by, updated_at, revision)
    VALUES (${TENANT.B.company}, ${world.base.ids.newId()}, ${TENANT.B.business}, true, ${USER}, now(), 1)`;
}

/** هدف الشركة الأولى في الاختبار، والفرع جزء منه لأن الجدولة بتحسب من الفرع. */
export function firstCompanyTarget(world: RatingClaimsWorld, branchId?: string): SeedTarget {
  return {
    company: world.company,
    businessId: TENANT.A.business,
    branchId: branchId ?? world.branchId,
  };
}

/** يحوّل قيمة وقت جاية من القاعدة إلى لحظة. */
export function instantOf(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

/** هدف الشركة التانية في الاختبار. */
export function secondCompanyTarget(): SeedTarget {
  return {
    company: TENANT.B.company,
    businessId: TENANT.B.business,
    branchId: TENANT.B.branch,
  };
}

/**
 * يزرع طلباً واحداً مستحقاً لشركة على فرع معيّن.
 *
 * الفرع جزء من الجدولة المعاد حسابها، فمفيش زرع من غير فرع.
 *
 * @param world        عالم القبول
 * @param target       الشركة والنشاط والفرع
 * @param first        أول رقم في تسلسل المعرّفات
 * @param sendDeadline الموعد النهائي المخزن، وnull يعني من غير موعد مخزن
 * @returns معرّف الطلب ومعرّف العميل
 */
export async function seedOneRequest(
  world: RatingClaimsWorld,
  target: SeedTarget,
  first: number,
  sendDeadline?: Date | null,
): Promise<{ readonly requestIds: readonly string[]; readonly customerIds: readonly string[] }> {
  const plan = seedPlan(target, {
    count: 1,
    first,
    ...(sendDeadline === undefined ? {} : { sendDeadline }),
  });
  await seedDueRows(world.base.owner, plan);
  return { requestIds: plan.requestIds, customerIds: plan.customerIds };
}

/** الجدولة المسجّلة للشركة دلوقتي، أو undefined لو ضاعت. */
export async function schedulerOf(
  queue: Queue,
  companyId: string,
): Promise<{ readonly template?: { readonly data?: unknown } } | undefined> {
  return queue.getJobScheduler(schedulerIdOf(companyId));
}

/** بيشيل جدولة الشركة: ده شكل ضياع الجدولة لما Redis يتمسح. */
export async function removeScheduler(queue: Queue, companyId: string): Promise<void> {
  await queue.removeJobScheduler(schedulerIdOf(companyId));
}

/** معرّفات الطلبات اللي وصلها حدث جاهزية، لكل شركة. */
export async function readyRequestIdsByCompany(
  world: RatingClaimsWorld,
  companies: readonly string[],
): Promise<Map<string, string[]>> {
  const ready = new Map<string, string[]>();
  for (const companyId of companies) {
    const rows = await world.base.owner`SELECT payload FROM outbox
      WHERE company_id = ${companyId} AND event_type = 'RatingRequestReady'`;
    ready.set(
      companyId,
      rows.map((row) => String((row['payload'] as { rating_request_id: string }).rating_request_id)),
    );
  }
  return ready;
}

/**
 * ينتظر أحداث جاهزية لكل شركة، بمهلة قصوى.
 *
 * الجدولة الحقيقية بتشتغل كل دقيقة، فالانتظار بيتم بالاستطلاع مش بنوم ثابت، وكل
 * استطلاع بيتقفل بمهلة عشان الاختبار ما يقعدش معلّق.
 *
 * @param world     عالم القبول
 * @param companies الشركات اللي لازم تتعافى
 * @param timeoutMs أقصى مدة انتظار
 * @returns معرّفات الطلبات اللي اتعافت لكل شركة
 */
export async function waitForReadyEvents(
  world: RatingClaimsWorld,
  companies: readonly string[],
  timeoutMs = 180_000,
): Promise<Map<string, string[]>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ready = await readyRequestIdsByCompany(world, companies);
    if (companies.every((companyId) => (ready.get(companyId)?.length ?? 0) > 0)) return ready;
    if (Date.now() > deadline) throw new Error('RATING_READY_EVENTS_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
