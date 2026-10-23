import type { CommissionPlan, CommissionSalary, ResolvedCommissionPlan } from './plan-types.ts';

/**
 * يقرأ مضاعف الراتب كأجزاء مئوية صحيحة؛ قراءة قيمة أدق من منزلتين لا تغيّر الحد بالتقريب.
 *
 * @param value نص موجب بعدد منازل لا يتجاوز اثنتين
 * @returns أجزاء k المئوية أو خطأ حد مسمى؛ لا تمر القيمة عبر number
 */
export function parseSalaryMultiple(
  value: string,
):
  | { readonly ok: true; readonly hundredths: bigint }
  | { readonly ok: false; readonly code: 'INVALID_THRESHOLD' } {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return { ok: false, code: 'INVALID_THRESHOLD' };
  const [integer = '0', fraction = ''] = value.split('.');
  const hundredths = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'));
  return hundredths > 0n ? { ok: true, hundredths } : { ok: false, code: 'INVALID_THRESHOLD' };
}

/**
 * يختار أحدث راتب سارٍ في آخر يوم، وليس الراتب الساري وقت كل جلسة.
 *
 * @param employeeId الموظفة التي نحسب لها الفترة
 * @param periodLastDay آخر يوم نشاط في الفترة محسوم من المستدعي
 * @param salaries تاريخ الرواتب بصف واحد لكل موظفة وتاريخ وفق §4
 * @returns الراتب بالفلس أو null عند غيابه؛ الراتب صفر قيمة موجودة
 */
export function selectSalaryOnLastDay(
  employeeId: string,
  periodLastDay: string,
  salaries: readonly CommissionSalary[],
): bigint | null {
  let selected: CommissionSalary | undefined;
  for (const salary of salaries) {
    if (salary.employeeId !== employeeId || salary.effectiveFrom > periodLastDay) continue;
    if (selected === undefined || salary.effectiveFrom > selected.effectiveFrom) selected = salary;
  }
  return selected?.amount ?? null;
}

/**
 * يحل حدود الخطة بمقياس دقيق؛ ضرب كل المبلغ في 100 يحفظ حد الراتب الكسري دون تقريب.
 *
 * @param plan خطة صالحة اجتازت validator؛ الشرائح المعطلة لا تحتاج راتباً
 * @param salaryOnLastDay راتب آخر يوم بالفلس أو null عند الغياب
 * @returns خطة بحدود صحيحة على مقياس مشترك أو NO_SALARY وفق D-57
 */
export function resolveCommissionPlan(
  plan: CommissionPlan,
  salaryOnLastDay: bigint | null,
):
  | { readonly ok: true; readonly plan: ResolvedCommissionPlan }
  | { readonly ok: false; readonly code: 'NO_SALARY' } {
  if (!plan.tiers.enabled) return { ok: true, plan: { base: plan.base, tiers: plan.tiers } };
  const salaryMultiple = plan.tiers.steps[0]?.from.kind === 'SALARY_MULTIPLE';
  if (salaryMultiple && salaryOnLastDay === null) return { ok: false, code: 'NO_SALARY' };
  const scale = salaryMultiple ? 100n : 1n;
  const steps = plan.tiers.steps.map((step) => ({
    from: salaryMultiple ? step.from.value * (salaryOnLastDay ?? 0n) : step.from.value,
    calc: step.calc,
  }));
  return {
    ok: true,
    plan: { base: plan.base, tiers: { ...plan.tiers, steps, thresholdScale: scale } },
  };
}
