import { MONEY_MAX } from '@pospay/domain';

import { ServiceError } from './errors.ts';
import type { ServiceCommissionRule } from './service-commission-rule.ts';

/** الحقول اللي بيتفحص عليها مسودة الخدمة قبل أي كتابة. */
export interface ServiceDraftFacts {
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly price: bigint;
  readonly commission_rule: ServiceCommissionRule;
  readonly duration_minutes: number | null;
}

/**
 * يتحقق من الاسم الإنجليزي: مطلوب، وطوله من 1 إلى 255 بعد التشذيب، وبلا محرف تحكم.
 *
 * @param nameEn الاسم الإنجليزي
 * @returns لا شيء عند القبول، ويرفض بخطأ مسمّى
 */
export function validateServiceNameEn(nameEn: string): void {
  if (nameEn.trim().length < 1 || nameEn.length > 255 || /\p{Cc}/u.test(nameEn))
    throw new ServiceError('SERVICE_NAME_INVALID');
}

/**
 * يتحقق من الاسم العربي: اختياري، ولو موجود طوله من 1 إلى 255 بعد التشذيب وبلا محرف تحكم.
 *
 * @param nameAr الاسم العربي أو غيابه
 * @returns لا شيء عند القبول، ويرفض بخطأ مسمّى
 */
export function validateServiceNameAr(nameAr: string | null): void {
  if (
    nameAr !== null &&
    (nameAr.trim().length < 1 || nameAr.length > 255 || /\p{Cc}/u.test(nameAr))
  )
    throw new ServiceError('SERVICE_NAME_INVALID');
}

/**
 * يفحص مدة الخدمة: دقائق صحيحة من 1 إلى 600، والقيمة الفارغة تعني إن الخدمة مالهاش مدة معروفة.
 * الدالة بترجع الخطأ مش بترميه، عشان دالة الاستيراد (32b-1) تجمّع أخطاء كل حقل في الخدمة الواحدة.
 *
 * @param value المدة بالدقائق أو غيابها
 * @returns الخطأ المسمّى لو المدة برّه المدى، و`null` لو سليمة
 */
export function validateServiceDuration(value: number | null): ServiceError | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1 || value > 600)
    return new ServiceError('SERVICE_DURATION_INVALID');
  return null;
}

/**
 * يتحقق من قاعدة العمولة: PCT نقاط أساس 0–10000، FIXED فلوس غير سالبة داخل numeric(14,3)؛
 * FOLLOW_PLAN وZERO بلا قيمة. المعاني يحددها SPEC §5، والنوع ملك نطاق catalog.
 *
 * @param rule القاعدة الصافية
 * @returns لا شيء عند القبول، ويرفض بخطأ مسمّى
 */
export function validateServiceCommissionRule(rule: ServiceCommissionRule): void {
  const invalid = () => {
    throw new ServiceError('SERVICE_COMMISSION_RULE_INVALID');
  };
  if (typeof rule !== 'object' || rule === null) return invalid();
  switch (rule.kind) {
    case 'FOLLOW_PLAN':
    case 'ZERO':
      if ('value' in rule) invalid();
      return;
    case 'PCT':
    case 'FIXED':
      if (
        typeof rule.value !== 'bigint' ||
        rule.value < 0n ||
        rule.value > (rule.kind === 'PCT' ? 10_000n : MONEY_MAX)
      )
        invalid();
      return;
    default:
      return invalid();
  }
}

/**
 * يتحقق من بنود الخدمة كاملة قبل أي كتابة؛ دالة الاستيراد (32b) تنادي نفس الفحص لكل صف.
 *
 * @param terms البنود الصافية بالفلوس
 * @returns لا شيء عند القبول، ويرفض بأول خطأ مسمّى
 */
export function validateServiceDraft(terms: ServiceDraftFacts): void {
  validateServiceNameEn(terms.name_en);
  validateServiceNameAr(terms.name_ar);
  if (typeof terms.price !== 'bigint' || terms.price < 0n || terms.price > MONEY_MAX)
    throw new ServiceError('SERVICE_PRICE_INVALID');
  validateServiceCommissionRule(terms.commission_rule);
  const duration = validateServiceDuration(terms.duration_minutes);
  if (duration !== null) throw duration;
}
