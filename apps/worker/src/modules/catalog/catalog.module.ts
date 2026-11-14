import type { ClaimedEvent, DeliveryOutcome, IdGenerator, TenantWrappers } from '@pospay/db';
import { createLogger } from '@pospay/observability';

import { startServiceCategoryClosingProcessor } from './jobs/service-category-closing.processor.ts';
import type { Clock } from './ports/clock.port.ts';
import { serviceCategoryClosingTransactions } from './persistence/service-category-closing.transactions.ts';
import { RunServiceCategoryClosing } from './use-cases/run-service-category-closing/run-service-category-closing.ts';

// مهلة معاملة القفل: ألف خدمة بتاخد حوالي ٣٠٠ مللي ثانية، ومفيش حد أقصى لعدد خدمات التصنيف،
// فالمهلة هي الحد، ومعها SERVICE_CATEGORY_CLOSING_FAILED بيقفل الصف بدل ما يفضل معلقاً للأبد.
const SERVICE_CATEGORY_CLOSING_TIMEOUT_MS = 60_000;
// كتابة الفشل بتجري بعد انتهاء مهلة القفل، فمهلتها قصيرة حتى لا تضاعف زمن الإمساك بالاتصال.
const SERVICE_CATEGORY_CLOSING_FAILURE_TIMEOUT_MS = 5_000;

/**
 * يشغّل عامل قفل وفتح التصنيفات الكبيرة في الـ worker: طلب واحد في الطابور لكل عملية.
 *
 * @param database بوابة المستأجر اللي بتنفّذ المعاملات
 * @param ids      مولّد المعرّفات لمعرّفات التدقيق
 * @param redisUrl عنوان Redis اللي فيه الطابور
 * @param clock    الساعة المحقونة لحدود الموعد النهائي
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
  const processor = startServiceCategoryClosingProcessor(
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
  return {
    eventTypes: ['ServiceCategoryClosingRequested'],
    deliver: (event: ClaimedEvent, next: (event: ClaimedEvent) => Promise<DeliveryOutcome>) =>
      event.eventType === 'ServiceCategoryClosingRequested'
        ? processor.deliver(event)
        : next(event),
    ready: processor.ready,
    close: processor.close,
  };
}
