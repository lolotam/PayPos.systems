import type {
  CommissionRuleLine,
  ServiceCommissionOverride,
  ServiceCommissionRule,
} from './commission-types.ts';

/**
 * يختار تجاوز الموظفة والخدمة بتاريخ النشاط؛ أحدث إنشاء ثم أكبر هوية يفوز.
 * التجاوز الفايز من نوع FOLLOW_SERVICE يرجع لقطة البند المحفوظة نفسها: مش تجاوز أقدم
 * ومش الكتالوج الحي؛ وFOLLOW_PLAN معناه خطة الموظفة زي ما هو.
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
  const rule = selected?.rule;
  // إعادة التوجيه بتفتح لقطة البند نفسها، فالتجاوز الأقدم لا يرجع والكتالوج الحي مش داخل المحرك.
  if (rule === undefined || rule.kind === 'FOLLOW_SERVICE') return line.ruleSnapshot;
  return rule;
}
