import { assertMoney, type Money } from '@pospay/domain';

import { PackageRuleError } from './errors.js';

/** تعريف مشترك للنوع والبيع والاستيراد؛ العدد الأصلي هو أساس التقييم دائماً. */
export interface PackageComponentDefinition {
  readonly serviceId: string;
  readonly sessions: number;
  readonly remainingSessions?: number;
}

/**
 * بيرفض السعر السالب أو غير القابل للتخزين قبل ما يدخل في توزيع الباقة.
 *
 * @param price المبلغ بالفلوس
 * @returns نفس السعر بعد التأكد من النوع وحدود numeric(14,3)
 */
export function validatePackagePrice(price: Money): Money {
  try {
    assertMoney(price);
  } catch {
    throw new PackageRuleError('INVALID_PRICE');
  }
  if (price < 0n) throw new PackageRuleError('INVALID_PRICE');
  return price;
}

/**
 * بيحمي تعريف النوع والبيع والاستيراد بنفس القواعد عشان المعاينة والتنفيذ ما يختلفوش.
 * المتبقي اختياري للتعريف الجديد، ولو موجود لازم يقع بين صفر والعدد الأصلي.
 *
 * @param price سعر الباقة الأصلي أو المدفوع بالفلوس
 * @param components مكونات الباقة بأعداد الجلسات الأصلية
 * @returns لا شيء؛ التعريف غير الصالح بيترفض بخطأ مسمّى
 */
export function validatePackageDefinition(
  price: Money,
  components: readonly PackageComponentDefinition[],
): void {
  validatePackagePrice(price);
  if (components.length === 0) throw new PackageRuleError('INVALID_COMPONENTS');
  const seen = new Set<string>();
  for (const component of components) {
    if (component.serviceId.length === 0) throw new PackageRuleError('INVALID_COMPONENTS');
    if (seen.has(component.serviceId)) throw new PackageRuleError('DUPLICATE_SERVICE');
    seen.add(component.serviceId);
    if (!Number.isSafeInteger(component.sessions) || component.sessions < 1) {
      throw new PackageRuleError('INVALID_SESSIONS');
    }
    const remaining = component.remainingSessions;
    if (
      remaining !== undefined &&
      (!Number.isSafeInteger(remaining) || remaining < 0 || remaining > component.sessions)
    ) {
      throw new PackageRuleError('INVALID_REMAINING_SESSIONS');
    }
  }
}
