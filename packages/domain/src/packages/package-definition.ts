import { assertMoney, type Money } from '../money.js';

import { PackageRuleError } from './errors.js';

/** قرار المالك 2026-10-03: سنة اشتراك يومي هي أكبر باقة معقولة، وأي رقم أكبر غالباً غلطة كتابة. */
export const MAX_PACKAGE_SESSIONS = 365;

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
 * عدد الجلسات من 1 لـ MAX_PACKAGE_SESSIONS؛ المتبقي اختياري للتعريف الجديد، ولو موجود لازم يقع بين صفر والعدد الأصلي.
 *
 * @param price سعر الباقة الأصلي أو المدفوع بالفلوس
 * @param components مكونات الباقة بأعداد الجلسات الأصلية
 * @param onIssue المعاينة تجمع كل الأخطاء عند تمريره؛ بدونه يظل الرفض عند أول خطأ
 * @returns لا شيء؛ بدون callback يرفض أول خطأ مسمّى، ومعه يبلّغ كل الأخطاء بترتيب القواعد
 */
export function validatePackageDefinition(
  price: Money,
  components: readonly PackageComponentDefinition[],
  onIssue?: (
    error: PackageRuleError,
    componentIndex: number | null,
    field: 'price' | 'components' | 'serviceId' | 'sessions' | 'remainingSessions',
  ) => void,
): void {
  const reject = (
    code: PackageRuleError['code'],
    index: number | null,
    field: Parameters<NonNullable<typeof onIssue>>[2],
  ) => {
    const error = new PackageRuleError(code);
    if (onIssue === undefined) throw error;
    onIssue(error, index, field);
  };
  try {
    validatePackagePrice(price);
  } catch (error) {
    if (onIssue === undefined || !(error instanceof PackageRuleError)) throw error;
    onIssue(error, null, 'price');
  }
  if (components.length === 0) reject('INVALID_COMPONENTS', null, 'components');
  const seen = new Set<string>();
  for (const [index, component] of components.entries()) {
    if (component.serviceId.length === 0) reject('INVALID_COMPONENTS', index, 'serviceId');
    if (seen.has(component.serviceId)) reject('DUPLICATE_SERVICE', index, 'serviceId');
    seen.add(component.serviceId);
    if (
      !Number.isSafeInteger(component.sessions) ||
      component.sessions < 1 ||
      component.sessions > MAX_PACKAGE_SESSIONS
    ) {
      reject('INVALID_SESSIONS', index, 'sessions');
    }
    const remaining = component.remainingSessions;
    if (
      remaining !== undefined &&
      (!Number.isSafeInteger(remaining) || remaining < 0 || remaining > component.sessions)
    ) {
      reject('INVALID_REMAINING_SESSIONS', index, 'remainingSessions');
    }
  }
}
