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

/** التشغيل الواحد: الصف والشركة واللحظة، عشان يوصلوا لكل خطوة من غير تكرار. */
interface ClosingRun {
  readonly companyId: string;
  readonly closingId: string;
  readonly at: Date;
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
  run: ClosingRun,
  code: ServiceCategoryClosingFailure,
): Promise<void> {
  await tx.execute(sql`UPDATE service_category_closings SET status='failed',error_code=${code},
    finished_at=${run.at.toISOString()}::timestamptz
    WHERE company_id=${run.companyId} AND id=${run.closingId} AND status='pending'`);
}

/**
 * يطبّق القفل أو الفتح على خدمات التصنيف ويكتب تدقيقها، وبعدها يكتب اكتمال الطلب بنفس المعاملة.
 * الكتابة كلها ذرّية: لو عدد صفوف التدقيق مش مطابق للمجموعة المقفولة، المعاملة تتراجع والصف
 * يفضل معلقاً والطابور يعيد المحاولة.
 */
async function applyClosing(
  tx: Tx,
  ids: IdGenerator,
  run: ClosingRun,
  row: ClosingRow,
): Promise<ServiceCategoryClosingOutcome> {
  const closing = row.action === 'close';
  const atIso = run.at.toISOString();
  const serviceIds = await lockServiceCategoryCascadeServices(tx, {
    companyId: run.companyId,
    businessId: row.business_id,
    categoryId: row.category_id,
    closing,
  });
  const count = decideServiceCategoryClosingCount(row.expected_service_count, serviceIds.length);
  if (count !== 'proceed') {
    await markFailed(tx, run, count);
    return { kind: 'failed', code: count };
  }
  const applied = await applyServiceCategoryClosing(tx, {
    companyId: run.companyId,
    businessId: row.business_id,
    categoryId: row.category_id,
    closing,
    at: atIso,
    expectedRevision: row.expected_revision,
    categoryAuditId: ids.newId(),
  });
  if (applied === 'revision-conflict') {
    await markFailed(tx, run, 'SERVICE_CATEGORY_REVISION_CONFLICT');
    return { kind: 'failed', code: 'SERVICE_CATEGORY_REVISION_CONFLICT' };
  }
  const audited = await tx.execute(
    serviceCategoryCascadeStatement({
      companyId: run.companyId,
      businessId: row.business_id,
      categoryId: row.category_id,
      closing,
      at: atIso,
      auditIds: JSON.stringify(
        serviceIds.map((serviceId) => ({ service_id: serviceId, audit_id: ids.newId() })),
      ),
      expectedCount: serviceIds.length,
    }),
  );
  if (audited.length !== serviceIds.length)
    throw new Error('SERVICE_CATEGORY_CLOSING_AUDIT_MISMATCH');
  await tx.execute(sql`UPDATE service_category_closings SET status='completed',
    services_changed=${serviceIds.length},finished_at=${atIso}::timestamptz
    WHERE company_id=${run.companyId} AND id=${run.closingId} AND status='pending'`);
  return { kind: 'completed', servicesChanged: serviceIds.length };
}

/** القرار وفحص الصف تحت قفل التصنيف: الفشل يكتب صف الطلب بس، والمتابعة تمشي على الخدمات. */
async function runInTransaction(
  tx: Tx,
  ids: IdGenerator,
  run: ClosingRun,
): Promise<ServiceCategoryClosingOutcome> {
  const target = await readClosing(tx, run.companyId, run.closingId, WITHOUT_LOCK);
  if (target === null) return { kind: 'noop' };
  const category = await lockCategory(tx, run.companyId, target.business_id, target.category_id);
  if (category === null) throw new Error('SERVICE_CATEGORY_CLOSING_CATEGORY_MISSING');
  const row = await readClosing(tx, run.companyId, run.closingId, WITH_UPDATE_LOCK);
  if (row === null) return { kind: 'noop' };
  const decision = decideServiceCategoryClosing(jobOf(row), categoryOf(category), run.at);
  if (decision === 'noop') return { kind: 'noop' };
  if (decision !== 'proceed') {
    await markFailed(tx, run, decision);
    return { kind: 'failed', code: decision };
  }
  return applyClosing(tx, ids, run, row);
}

/** يقرأ طالب الطلب في معاملة قصيرة: الـ actor في تدقيق الـ SQL هو اللي طلب العملية. */
async function readRequester(
  database: Pick<TenantWrappers, 'withTenant'>,
  companyId: string,
  closingId: string,
): Promise<string | null> {
  return database.withTenant(companyId, async (tx) => {
    const [row] = await tx.execute<{ requested_by: string }>(sql`SELECT requested_by
      FROM service_category_closings WHERE company_id=${companyId} AND id=${closingId}`);
    return row?.requested_by ?? null;
  });
}

/**
 * تشغيل الطلب في معاملة واحدة: القفل على التصنيف وصف الطلب والخدمات والتدقيق والاكتمال.
 * صف شركة تانية ما بيظهرش تحت عزل الصفوف، فالتشغيل بيعمل لا عمل.
 */
async function runClosing(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  run: ClosingRun,
  timeoutMs: number,
): Promise<ServiceCategoryClosingOutcome> {
  const requester = await readRequester(database, run.companyId, run.closingId);
  if (requester === null) return { kind: 'noop' };
  return database.withTenant(run.companyId, (tx) => runInTransaction(tx, ids, run), {
    userId: requester,
    timeoutMs,
  });
}

/**
 * معاملات قفل وفتح التصنيف في قاعدة البيانات: معاملة واحدة لكل تشغيل، ومعاملة قصيرة لكتابة الفشل.
 *
 * @param database          بوابة المستأجر اللي بتنفّذ المعاملات
 * @param ids               مولّد المعرّفات لمعرّفات التدقيق
 * @param timeoutMs         مهلة معاملة التشغيل
 * @param failureTimeoutMs  مهلة معاملة كتابة الفشل
 * @returns المعاملات جاهزة للاستخدام من حالة الاستخدام
 */
export function serviceCategoryClosingTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  timeoutMs: number,
  failureTimeoutMs: number,
): ServiceCategoryClosingTransactions {
  return {
    run: (companyId, closingId, at) =>
      runClosing(database, ids, { companyId, closingId, at }, timeoutMs),
    fail: (companyId, closingId, code, at) =>
      database.withTenant(
        companyId,
        async (tx) => {
          await markFailed(tx, { companyId, closingId, at }, code);
        },
        { timeoutMs: failureTimeoutMs },
      ),
    readRequester: (companyId, closingId) => readRequester(database, companyId, closingId),
  };
}
