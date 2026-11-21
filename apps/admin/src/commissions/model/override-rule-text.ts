import type { CommissionServiceOverrideRuleView } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { formatKwd, t, type Locale } from '@pospay/i18n';

/** نسبة مئوية من نقاط الأساس بحساب صحيح: 1500 نقطة = 15.00% و10000 نقطة = 100.00%. */
function percentText(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  return `${whole}.${String(fraction).padStart(2, '0')}%`;
}

/**
 * سطر العرض بتاعة القاعدة الواحدة: المبلغ الثابت بالدينار بثلاث خانات، والنسبة كنسبة
 * مئوية، والنوعين التانيين بعنوانهم من كتالوج الكتالوج (مش مكرر هنا).
 */
export function overrideRuleText(rule: CommissionServiceOverrideRuleView, locale: Locale): string {
  if (rule.kind === 'PCT') return percentText(rule.value);
  if (rule.kind === 'FIXED') return formatKwd(parseMoney(rule.value));
  if (rule.kind === 'ZERO') return t(locale, 'catalogServices.ruleZero');
  return t(locale, 'catalogServices.ruleFollowPlan');
}
