import type { ServiceImportRow } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';

/** تسمية قاعدة العمولة في جدول المعاينة: اسم القاعدة وقيمتها المعروضة على حدة. */
export type ServiceImportRuleDisplay = { label: string; value: string | undefined };

/**
 * يبني تسمية قاعدة العمولة لصف معاينة: القاعدة الافتراضية تقرأ كقاعدة مُختارة
 * تلقائياً، والقواعد ذات القيمة تعرض قيمتها بجوار اسمها.
 *
 * @param row    صف المعاينة المطبّع
 * @param locale لغة العرض
 * @returns اسم القاعدة وقيمتها إن وُجدت
 */
export function serviceImportRuleDisplay(
  row: ServiceImportRow,
  locale: Locale,
): ServiceImportRuleDisplay {
  if (row.commission_rule_defaulted)
    return { label: t(locale, 'catalogServiceImport.ruleDefaulted'), value: undefined };
  const kind = row.commission_rule.kind;
  if (kind === 'FOLLOW_PLAN')
    return { label: t(locale, 'catalogServiceImport.ruleFollowPlan'), value: undefined };
  if (kind === 'ZERO') return { label: t(locale, 'catalogServiceImport.ruleZero'), value: undefined };
  const label = t(
    locale,
    kind === 'PCT' ? 'catalogServiceImport.rulePct' : 'catalogServiceImport.ruleFixed',
  );
  const value = row.commission_value;
  return { label, value: value === null ? undefined : String(value) };
}
