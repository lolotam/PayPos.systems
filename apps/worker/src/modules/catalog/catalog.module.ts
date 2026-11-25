import type { ClaimedEvent, DeliveryOutcome, IdGenerator, TenantWrappers } from '@pospay/db';
import { createLogger } from '@pospay/observability';

import { startServiceCategoryClosingProcessor } from './jobs/service-category-closing.processor.ts';
import { startServiceImportProcessor } from './jobs/service-import-commit.processor.ts';
import { startServiceImportRecoveryProcessor } from './jobs/service-import-recovery.processor.ts';
import type { Clock } from './ports/clock.port.ts';
import { serviceCategoryClosingTransactions } from './persistence/service-category-closing.transactions.ts';
import { serviceImportCommitTransactions } from './persistence/service-import-commit.transactions.ts';
import { serviceImportRecoveryTransactions } from './persistence/service-import-recovery.transactions.ts';
import { RunServiceCategoryClosing } from './use-cases/run-service-category-closing/run-service-category-closing.ts';
import { CommitServiceImport } from './use-cases/commit-service-import/commit-service-import.ts';
import { RecoverServiceImports } from './use-cases/recover-service-imports/recover-service-imports.ts';

// مهلة معاملة القفل: ألف خدمة بتاخد حوالي ٣٠٠ مللي ثانية، ومفيش حد أقصى لعدد خدمات التصنيف،
// فالمهلة هي الحد، ومعها SERVICE_CATEGORY_CLOSING_FAILED بيقفل الصف بدل ما يفضل معلقاً للأبد.
const SERVICE_CATEGORY_CLOSING_TIMEOUT_MS = 60_000;
// كتابة الفشل بتجري بعد انتهاء مهلة القفل، فمهلتها قصيرة حتى لا تضاعف زمن الإمساك بالاتصال.
const SERVICE_CATEGORY_CLOSING_FAILURE_TIMEOUT_MS = 5_000;
// بيانات المسح قصيرة ومفهرسة على (company,status,requested_at)؛ لا تستخدم ميزانية المعاملة المالية أبدًا.
const SERVICE_IMPORT_RECOVERY_TIMEOUT_MS = 5_000;

/** مسح استرداد طلبات تثبيت الخدمات: مُسجَّل قبل إقرار الحدث، ومجدول لكل شركة على حدة. */
function startImportRecovery(
  database: Pick<TenantWrappers, 'withTenant'>,
  redisUrl: string,
  clock: Clock,
  prefix: string | undefined,
) {
  return startServiceImportRecoveryProcessor(
    new RecoverServiceImports(
      serviceImportRecoveryTransactions(database, { timeoutMs: SERVICE_IMPORT_RECOVERY_TIMEOUT_MS }),
      clock,
    ),
    redisUrl,
    prefix,
  );
}

/**
 * يشغّل عامل الكتالوج في الـ worker: قفل وفتح التصنيفات الكبيرة وتثبيت استيراد الخدمات،
 * كل طلب في الطابور لعملية واحدة.
 *
 * @param database بوابة المستأجر اللي بتنفّذ المعاملات
 * @param ids      مولّد المعرّفات لمعرّفات التدقيق والخدمات
 * @param redisUrl عنوان Redis اللي فيه الطابور
 * @param clock    الساعة المحقونة لحدود الموعد النهائي ولحظات الإتمام
 * @param prefix   بادئة طوابير BullMQ
 * @returns أنواع الأحداث والتسليم والجاهزية والإغلاق
 */
export function startCatalogWorker(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
  redisUrl: string,
  clock: Clock,
  prefix?: string,
) {
  // اسم الحدث لازم يكون مسجّل: المراقب بيستبدل أي رسالة مش في قايمة الأحداث، فالتشخيص كان بيضيع.
  const logger = createLogger('error', { events: ['service category closing failed'] });
  const closing = startServiceCategoryClosingProcessor(
    new RunServiceCategoryClosing(
      serviceCategoryClosingTransactions(
        database,
        ids,
        SERVICE_CATEGORY_CLOSING_TIMEOUT_MS,
        SERVICE_CATEGORY_CLOSING_FAILURE_TIMEOUT_MS,
      ),
      clock,
      {
        failed: ({ companyId, closingId, requestedBy, code }) =>
          logger.error(
            { company_id: companyId, closing_id: closingId, user_id: requestedBy, code },
            'service category closing failed',
          ),
      },
    ),
    redisUrl,
    prefix,
  );
  // المستهلك مسجّل قبل المنتج (32b-5): لا شيء يصدر ServiceImportCommitRequested بعد في الإنتاج بعد.
  const importCommit = startServiceImportProcessor(
    new CommitServiceImport(serviceImportCommitTransactions(database, ids), ids, clock),
    redisUrl,
    prefix,
  );
  const recovery = startImportRecovery(database, redisUrl, clock, prefix);
  return {
    eventTypes: ['ServiceCategoryClosingRequested', 'ServiceImportCommitRequested'],
    deliver: (event: ClaimedEvent, next: (event: ClaimedEvent) => Promise<DeliveryOutcome>) =>
      deliverCatalogEvent({ event, next, closing, importCommit, recovery }),
    ready: async () => {
      await closing.ready();
      await importCommit.ready();
      await recovery.ready();
    },
    close: async () => {
      await closing.close();
      await importCommit.close();
      await recovery.close();
    },
  };
}

/** التسليم يوجّه الحدث إلى عامله، ومع حدث التثبيت يسجّل المسح أولًا (ADR-0022). */
async function deliverCatalogEvent(parts: {
  event: ClaimedEvent;
  next: (event: ClaimedEvent) => Promise<DeliveryOutcome>;
  closing: { deliver(event: ClaimedEvent): Promise<DeliveryOutcome> };
  importCommit: { deliver(event: ClaimedEvent): Promise<DeliveryOutcome> };
  recovery: { register(companyId: string): Promise<void> };
}): Promise<DeliveryOutcome> {
  const { event, next, closing, importCommit, recovery } = parts;
  if (event.eventType === 'ServiceCategoryClosingRequested') return closing.deliver(event);
  if (event.eventType !== 'ServiceImportCommitRequested') return next(event);
  try {
    await recovery.register(event.companyId);
  } catch {
    return { delivered: false, error: 'SERVICE_IMPORT_RECOVERY_SCHEDULE_RETRY', retryInMs: 2000 };
  }
  return importCommit.deliver(event);
}
