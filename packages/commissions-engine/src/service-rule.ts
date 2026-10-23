import type {
  CommissionRuleLine,
  ServiceCommissionOverride,
  ServiceCommissionRule,
} from './commission-types.ts';

/**
 * يختار تجاوز الموظفة والخدمة بتاريخ النشاط؛ أحدث إنشاء ثم أكبر هوية يفوز، وإلا لقطة البند.
 *
 * @param line الموظفة والخدمة والتاريخ المحلي المحسوم ولقطة القاعدة
 * @param overrides التجاوزات المرشحة؛ غيابها لا يعني ZERO
 * @returns القاعدة المختارة؛ FOLLOW_PLAN يترك تسعير الخطة للدالة المستهلكة
 */
export function resolveServiceCommissionRule(
  line: CommissionRuleLine,
  overrides: readonly ServiceCommissionOverride[],
): ServiceCommissionRule {
  let selected: ServiceCommissionOverride | undefined;
  for (const override of overrides) {
    if (
      override.employeeId !== line.employeeId ||
      override.serviceId !== line.serviceId ||
      override.effectiveFrom > line.businessDate
    )
      continue;
    if (
      selected === undefined ||
      override.createdAt > selected.createdAt ||
      (override.createdAt === selected.createdAt && override.id > selected.id)
    )
      selected = override;
  }
  return selected?.rule ?? line.ruleSnapshot;
}
