import {
  applyServiceCategoryClosing,
  lockServiceCategoryCascadeServices,
  serviceCategoryCascadeStatement,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

import {
  decideServiceCategoryClosing,
  decideServiceCategoryClosingCount,
  type LockedServiceCategory,
  type ServiceCategoryClosingFailure,
  type ServiceCategoryClosingJob,
} from '../domain/service-category-closing-job.ts';
import type {
  ServiceCategoryClosingOutcome,
  ServiceCategoryClosingTransactions,
} from '../ports/service-category-closing.port.ts';

type ClosingRow = {
  business_id: string;
  category_id: string;
  action: 'close' | 'reopen';
  status: 'pending' | 'completed' | 'failed';
  expected_revision: number;
  expected_service_count: number;
  deadline_at: Date;
};

type CategoryRow = {
  revision: number;
  closed_at: Date | null;
};

interface ClosingTarget {
  readonly companyId: string;
  readonly closingId: string;
}

interface ClosingContext extends ClosingTarget {
  readonly ids: IdGenerator;
  readonly now: () => Date;
}

const CLOSING_COLUMNS = sql`business_id,category_id,action,status,expected_revision,
  expected_service_count,deadline_at`;
const WITHOUT_LOCK = sql``;
const WITH_UPDATE_LOCK = sql`FOR UPDATE`;

const jobOf = (row: ClosingRow): ServiceCategoryClosingJob => ({
  action: row.action,
  status: row.status,
  expectedRevision: row.expected_revision,
  expectedServiceCount: row.expected_service_count,
  deadlineAt: new Date(row.deadline_at),
});

const categoryOf = (row: CategoryRow): LockedServiceCategory => ({
  revision: row.revision,
  closedAt: row.closed_at === null ? null : new Date(row.closed_at),
});

/**
 * يقرأ صف الطلب: مرة بغير قفل عشان نعرف التصنيف، ومرة بقفل عشان نقرأ الحالة الأخيرة بعد القفل.
 *
 * @param tx        معاملة المستأجر الحالية
 * @param companyId الشركة المالكة للصف
 * @param closingId صف طلب القفل أو الفتح
 * @param lock      clause القفل، أو فراغ لو القراءة من غير قفل
 * @returns صف الطلب أو غيابه
 */
async function readClosing(
  tx: Tx,
  companyId: string,
  closingId: string,
  lock: SQL,
): Promise<ClosingRow | null> {
  const rows =
    await tx.execute<ClosingRow>(sql`SELECT ${CLOSING_COLUMNS} FROM service_category_closings
    WHERE company_id=${companyId} AND id=${closingId} ${lock}`);
  return rows[0] ?? null;
}

/** يقفل التصنيف قبل صف الطلب، عشان الطلبات على التصنيف نفسه تتسلسل زي كل مسارات الكتابة. */
async function lockCategory(
  tx: Tx,
  companyId: string,
  businessId: string,
  categoryId: string,
): Promise<CategoryRow | null> {
  const rows = await tx.execute<CategoryRow>(sql`SELECT revision,closed_at FROM service_categories
    WHERE company_id=${companyId} AND business_id=${businessId} AND id=${categoryId} FOR UPDATE`);
  return rows[0] ?? null;
}

/** يكتب رمز الفشل على صف معلق فقط؛ الصف اللي خلص ما بيتغيرش. */
async function markFailed(
  tx: Tx,
  target: ClosingTarget,
  code: ServiceCategoryClosingFailure,
  at: Date,
): Promise<void> {
  await tx.execute(sql`UPDATE service_category_closings SET status='failed',error_code=${code},
    finished_at=${at.toISOString()}::timestamptz
    WHERE company_id=${target.companyId} AND id=${target.closingId} AND status='pending'`);
}

/**
 * يطبّق القفل أو الفتح على خدمات التصنيف ويكتب تدقيقها، وبعدها يكتب اكتمال الطلب بنفس المعاملة.
 * الكتابة كلها ذرّية: لو عدد صفوف التدقيق مش مطابق للمجموعة المقفولة، المعاملة تتراجع والصف
 * يفضل معلقاً والطابور يعيد المحاولة.
 */
async function applyClosing(
  tx: Tx,
  context: ClosingContext,
  row: ClosingRow,
  at: Date,
): Promise<ServiceCategoryClosingOutcome> {
  const closing = row.action === 'close';
  const atIso = at.toISOString();
  const serviceIds = await lockServiceCategoryCascadeServices(tx, {
    companyId: context.companyId,
    businessId: row.business_id,
    categoryId: row.category_id,
    closing,
  });
  const count = decideServiceCategoryClosingCount(row.expected_service_count, serviceIds.length);
  if (count !== 'proceed') {
    await markFailed(tx, context, count, at);
    return { kind: 'failed', code: count };
  }
  const applied = await applyServiceCategoryClosing(tx, {
    companyId: context.companyId,
    businessId: row.business_id,
    categoryId: row.category_id,
    closing,
    at: atIso,
    expectedRevision: row.expected_revision,
    categoryAuditId: context.ids.newId(),
  });
  if (applied === 'revision-conflict') {
    await markFailed(tx, context, 'SERVICE_CATEGORY_REVISION_CONFLICT', at);
    return { kind: 'failed', code: 'SERVICE_CATEGORY_REVISION_CONFLICT' };
  }
  const audited = await tx.execute(
    serviceCategoryCascadeStatement({
      companyId: context.companyId,
      businessId: row.business_id,
      categoryId: row.category_id,
      closing,
      at: atIso,
      auditIds: JSON.stringify(
        serviceIds.map((serviceId) => ({ service_id: serviceId, audit_id: context.ids.newId() })),
      ),
      expectedCount: serviceIds.length,
    }),
  );
  if (audited.length !== serviceIds.length)
    throw new Error('SERVICE_CATEGORY_CLOSING_AUDIT_MISMATCH');
  await tx.execute(sql`UPDATE service_category_closings SET status='completed',
    services_changed=${serviceIds.length},finished_at=${atIso}::timestamptz
    WHERE company_id=${context.companyId} AND id=${context.closingId} AND status='pending'`);
  return { kind: 'completed', servicesChanged: serviceIds.length };
}

/**
 * القرار وفحص الصف تحت قفل التصنيف: الفشل يكتب صف الطلب بس، والمتابعة تمشي على الخدمات.
 * الساعة تُقرأ بعد الأقفال، لأن الموعد لازم يُقاس على لحظة الفحص نفسها مش على لحظة وصول الطلب.
 */
async function runInTransaction(
  tx: Tx,
  context: ClosingContext,
): Promise<ServiceCategoryClosingOutcome> {
  const target = await readClosing(tx, context.companyId, context.closingId, WITHOUT_LOCK);
  if (target === null) return { kind: 'noop' };
  const category = await lockCategory(
    tx,
    context.companyId,
    target.business_id,
    target.category_id,
  );
  if (category === null) throw new Error('SERVICE_CATEGORY_CLOSING_CATEGORY_MISSING');
  const row = await readClosing(tx, context.companyId, context.closingId, WITH_UPDATE_LOCK);
  if (row === null) return { kind: 'noop' };
  const at = context.now();
  const decision = decideServiceCategoryClosing(jobOf(row), categoryOf(category), at);
  if (decision === 'noop') return { kind: 'noop' };
  if (decision !== 'proceed') {
    await markFailed(tx, context, decision, at);
    return { kind: 'failed', code: decision };
  }
  return applyClosing(tx, context, row, at);
}

/** يقرأ طالب الطلب في معاملة قصيرة: الـ actor في تدقيق الـ SQL هو اللي طلب العملية. */
async function readRequester(
  database: Pick<TenantWrappers, 'withTenant'>,
  companyId: string,
  closingId: string,
  timeoutMs: number,
): Promise<string | null> {
  return database.withTenant(
    companyId,
    async (tx) => {
      const [row] = await tx.execute<{ requested_by: string }>(sql`SELECT requested_by
        FROM service_category_closings WHERE company_id=${companyId} AND id=${closingId}`);
      return row?.requested_by ?? null;
    },
    { timeoutMs },
  );
}

/**
 * تشغيل الطلب في معاملة واحدة: القفل على التصنيف وصف الطلب والخدمات والتدقيق والاكتمال.
 * صف شركة تانية ما بيظهرش تحت عزل الصفوف، فالتشغيل بيعمل لا عمل.
 */
async function runClosing(
  context: ClosingContext,
  database: Pick<TenantWrappers, 'withTenant'>,
  timeoutMs: number,
  failureTimeoutMs: number,
): Promise<ServiceCategoryClosingOutcome> {
  const requester = await readRequester(
    database,
    context.companyId,
    context.closingId,
    failureTimeoutMs,
  );
  if (requester === null) return { kind: 'noop' };
  return database.withTenant(context.companyId, (tx) => runInTransaction(tx, context), {
    userId: requester,
    timeoutMs,
  });
}

export function serviceCategoryClosingTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  timeoutMs: number,
  failureTimeoutMs: number,
): ServiceCategoryClosingTransactions {
  return {
    run: (companyId, closingId, now) =>
      runClosing({ companyId, closingId, ids, now }, database, timeoutMs, failureTimeoutMs),
    fail: (companyId, closingId, code, at) =>
      database.withTenant(
        companyId,
        async (tx) => {
          await markFailed(tx, { companyId, closingId }, code, at);
        },
        { timeoutMs: failureTimeoutMs },
      ),
    readRequester: (companyId, closingId) =>
      readRequester(database, companyId, closingId, failureTimeoutMs),
  };
}
