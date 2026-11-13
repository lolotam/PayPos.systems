import { ServiceError } from './errors.ts';
import type { ServiceCategoryLock } from './service-category-assignment.ts';
import type { ServiceRecord } from './service.ts';

/**
 * يخطط إغلاق خدمة منفردة من غير علامة تصنيف: النسخة تُفحص قبل الحالة، والخدمة المغلقة لا تُغلق
 * مرة أخرى. إعادة الفتح لاحقاً لا تُنسب الإغلاق لأي تصنيف.
 *
 * @param current الخدمة المقفولة الحالية
 * @param expectedRevision النسخة التي شاهدها المدير
 * @param at وقت الإغلاق المحقون
 * @returns الخدمة بعد الإغلاق مع رفع النسخة وتحديث الوقت
 * @throws ServiceError عند تعارض النسخة أو كون الخدمة مغلقة بالفعل
 */
export function planServiceClose(
  current: ServiceRecord,
  expectedRevision: number,
  at: Date,
): ServiceRecord {
  if (expectedRevision !== current.revision) throw new ServiceError('SERVICE_REVISION_CONFLICT');
  if (current.closed_at !== null) throw new ServiceError('SERVICE_ALREADY_CLOSED');
  return {
    ...current,
    closed_at: at.toISOString(),
    closed_by_category_id: null,
    revision: current.revision + 1,
    updated_at: at.toISOString(),
  };
}

/**
 * يخطط فتح خدمة منفردة: النسخة تُفحص أولاً، والتصنيف المغلق يمنع الفتح لأنه سيجعل الخدمة متاحة
 * داخل تصنيف غير متاح. تُمسح علامة إغلاق التصنيف أيضاً حتى لا تعيد عملية فتح لاحقة حسابها مرتين.
 *
 * @param current الخدمة المقفولة الحالية
 * @param category تصنيف الخدمة المقفول، أو `null` لو كانت بلا تصنيف
 * @param expectedRevision النسخة التي شاهدها المدير
 * @param at وقت الفتح المحقون
 * @returns الخدمة المفتوحة بعد مسح وقت الإغلاق والعلامة ورفع النسخة
 * @throws ServiceError عند تعارض النسخة أو الحالة أو إغلاق التصنيف
 */
export function planServiceReopen(
  current: ServiceRecord,
  category: ServiceCategoryLock | null,
  expectedRevision: number,
  at: Date,
): ServiceRecord {
  if (expectedRevision !== current.revision) throw new ServiceError('SERVICE_REVISION_CONFLICT');
  if (current.closed_at === null) throw new ServiceError('SERVICE_NOT_CLOSED');
  if (category !== null && category.closed_at !== null)
    throw new ServiceError('SERVICE_CATEGORY_CLOSED');
  return {
    ...current,
    closed_at: null,
    closed_by_category_id: null,
    revision: current.revision + 1,
    updated_at: at.toISOString(),
  };
}
