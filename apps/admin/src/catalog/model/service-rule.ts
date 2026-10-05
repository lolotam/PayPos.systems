import type { ServiceCommissionRuleInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';

/** أنواع القاعدة الأربعة بالترتيب الذي تعرضه الشاشة. */
export const SERVICE_RULE_KINDS = ['FOLLOW_PLAN', 'ZERO', 'PCT', 'FIXED'] as const;
export type ServiceRuleKind = (typeof SERVICE_RULE_KINDS)[number];

/** اسم القاعدة المحلي للعرض فقط؛ التسعير يملكه commissions على السيرفر. */
export const SERVICE_RULE_LABEL: Record<ServiceCommissionRuleInput['kind'], MessageKey> = {
  FOLLOW_PLAN: 'catalogServices.ruleFollowPlan',
  ZERO: 'catalogServices.ruleZero',
  PCT: 'catalogServices.rulePct',
  FIXED: 'catalogServices.ruleFixed',
};

/**
 * يبني قاعدة صالحة للنوع المختار بقيمة افتراضية آمنة، عشان تغيير النوع ما يتركش قيمة يتيمة.
 *
 * @param kind نوع القاعدة المختار من القائمة
 * @returns قاعدة على السلك بالشكل اللي العقد بيقبله
 */
export function defaultServiceRule(kind: ServiceRuleKind): ServiceCommissionRuleInput {
  if (kind === 'PCT') return { kind: 'PCT', value: 0 };
  if (kind === 'FIXED') return { kind: 'FIXED', value: '0.000' };
  return { kind };
}

/** القيمة النصية الظاهرة في الحقل حسب النوع؛ النسبة رقم صحيح والمبلغ نص KWD. */
export function serviceRuleValueText(rule: ServiceCommissionRuleInput): string {
  if (rule.kind === 'PCT') return String(rule.value);
  if (rule.kind === 'FIXED') return rule.value;
  return '';
}

/**
 * يحوّل نص الحقل لقاعدة؛ النسبة أرقام صحيحة بس والمبلغ نص يمر على عقد السعر.
 * null يعني نص نسبة مرفوض، فالحقل بيحتفظ بآخر قيمة صالحة بدل ما Number() يقبل 0x1F4 أو 1e3 أو يعرض NaN.
 */
export function serviceRuleFromText(
  kind: 'PCT' | 'FIXED',
  text: string,
): ServiceCommissionRuleInput | null {
  if (kind === 'FIXED') return { kind: 'FIXED', value: text };
  const digits = text.trim();
  if (digits === '') return { kind: 'PCT', value: 0 };
  return /^\d{1,5}$/.test(digits) ? { kind: 'PCT', value: Number(digits) } : null;
}
