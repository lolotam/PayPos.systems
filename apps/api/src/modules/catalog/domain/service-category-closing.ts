import { ServiceCategoryError } from './errors.ts';
import type { ServiceCategoryRecord } from './service-category.ts';
import type { ServiceRecord } from './service.ts';

/** مدخلات إغلاق أو فتح تصنيف: النسخة المتوقعة وعدد الخدمات التي تؤكدها الشاشة. */
export interface ServiceCategoryClosingRequest {
  readonly expected_revision: number;
  readonly expected_service_count: number;
}

/** سجل قبل العملية وبعدها، محفوظ بالكامل للحفظ الذري والتدقيق. */
export interface ServiceRecordChange<T> {
  readonly before: T;
  readonly after: T;
}

/** خطة إغلاق أو فتح تصنيف وكل الخدمات التي تتغير معه فقط. */
export interface ServiceCategoryClosingPlan {
  readonly category: ServiceRecordChange<ServiceCategoryRecord>;
  readonly services: readonly ServiceRecordChange<ServiceRecord>[];
}

/**
 * يخطط إغلاق تصنيف وخدماته المفتوحة: النسخة تُفحص قبل الحالة، والعدد المتوقع يمنع إغلاق مجموعة
 * غير المجموعة التي أكدها المدير. الخدمة المغلقة مسبقاً تحتفظ بوقتها ولا تكتسب علامة التصنيف.
 *
 * @param current التصنيف المقفول الحالي
 * @param request النسخة وعدد الخدمات المفتوحة المتوقعان
 * @param services خدمات التصنيف المحمّلة تحت القفل
 * @param at وقت الإغلاق المحقون
 * @returns التصنيف والخدمات قبل الإغلاق وبعده، بلا أي خدمة مغلقة مسبقاً
 * @throws ServiceCategoryError عند تعارض النسخة أو الحالة أو تغيّر العدد
 */
export function planServiceCategoryClose(
  current: ServiceCategoryRecord,
  request: ServiceCategoryClosingRequest,
  services: readonly ServiceRecord[],
  at: Date,
): ServiceCategoryClosingPlan {
  if (request.expected_revision !== current.revision)
    throw new ServiceCategoryError('SERVICE_CATEGORY_REVISION_CONFLICT');
  if (current.closed_at !== null) throw new ServiceCategoryError('SERVICE_CATEGORY_ALREADY_CLOSED');
  const open = services.filter((service) => service.closed_at === null);
  assertExpectedCount(request.expected_service_count, open.length);
  const iso = at.toISOString();
  return {
    category: {
      before: current,
      after: {
        ...current,
        closed_at: iso,
        revision: current.revision + 1,
        updated_at: iso,
      },
    },
    services: open.map((service) => ({
      before: service,
      after: {
        ...service,
        closed_at: iso,
        closed_by_category_id: current.id,
        revision: service.revision + 1,
        updated_at: iso,
      },
    })),
  };
}

/**
 * يخطط فتح تصنيف وإرجاع الخدمات التي أغلقها هو فقط: الخدمة المغلقة منفردة أو قبل إغلاق التصنيف
 * لا تتغير. النسخة تُفحص قبل الحالة، والعدد المتوقع يحمي قرار المدير من مجموعة متغيرة.
 *
 * @param current التصنيف المقفول الحالي
 * @param request النسخة وعدد الخدمات المعلّمة المتوقعان
 * @param marked الخدمات المحمّلة بعلامة هذا التصنيف تحت القفل
 * @param at وقت الفتح المحقون
 * @returns التصنيف والخدمات المعلّمة قبل الفتح وبعده
 * @throws ServiceCategoryError عند تعارض النسخة أو الحالة أو تغيّر العدد
 */
export function planServiceCategoryReopen(
  current: ServiceCategoryRecord,
  request: ServiceCategoryClosingRequest,
  marked: readonly ServiceRecord[],
  at: Date,
): ServiceCategoryClosingPlan {
  if (request.expected_revision !== current.revision)
    throw new ServiceCategoryError('SERVICE_CATEGORY_REVISION_CONFLICT');
  if (current.closed_at === null) throw new ServiceCategoryError('SERVICE_CATEGORY_NOT_CLOSED');
  const owned = marked.filter((service) => service.closed_by_category_id === current.id);
  assertExpectedCount(request.expected_service_count, owned.length);
  const iso = at.toISOString();
  return {
    category: {
      before: current,
      after: {
        ...current,
        closed_at: null,
        revision: current.revision + 1,
        updated_at: iso,
      },
    },
    services: owned.map((service) => ({
      before: service,
      after: {
        ...service,
        closed_at: null,
        closed_by_category_id: null,
        revision: service.revision + 1,
        updated_at: iso,
      },
    })),
  };
}

function assertExpectedCount(expected: number, actual: number): void {
  if (expected !== actual) throw new ServiceCategoryError('SERVICE_CATEGORY_COUNT_CHANGED');
}
