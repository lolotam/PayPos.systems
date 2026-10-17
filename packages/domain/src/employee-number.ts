/** أكبر رقم وظيفي مسموح (قرار المالك EN-Q8: رقم صحيح من 1 إلى 999999). */
export const EMPLOYEE_NUMBER_MAX = 999999;

/**
 * يجد أول رقم وظيفي غير مستخدم عند العدّاد أو بعده.
 * القاعدة: التخطي يشمل كل رقم مستخدم (EN-Q6)، والرقم المكتوب بالإيد لا يحرّك العدّاد.
 *
 * @param counter أول رقم يُفحص (يبدأ من 1 أو من رقم البداية الذي اختاره المالك)
 * @param usedAtOrAbove الأرقام المستخدمة فعلاً داخل الشركة، من العدّاد فما فوق، مصفوفة غير مرتبة أو Set جاهز؛
 *   مَن يستدعي الدالة لكل صف في دفعة يبني الـ Set مرة واحدة ويمرّره حتى لا يُعاد بناؤه مع كل موظف
 * @returns أول رقم حر، أو null إذا كان العدّاد خارج النطاق أو لم يبق رقم حر حتى 999999
 */
export function firstFreeEmployeeNumber(
  counter: number,
  usedAtOrAbove: ReadonlySet<number> | readonly number[],
): number | null {
  if (!Number.isInteger(counter) || counter < 1) return null;
  const used: ReadonlySet<number> = 'has' in usedAtOrAbove ? usedAtOrAbove : new Set(usedAtOrAbove);
  for (let candidate = counter; candidate <= EMPLOYEE_NUMBER_MAX; candidate++) {
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

/**
 * يحسب قيمة العدّاد التالية بعد رقم أُسند تلقائياً.
 * القاعدة: العدّاد يتقدم إلى الرقم المسنَد زائد واحد، ويتوقف عند 1000000 بعد آخر رقم مسموح.
 *
 * @param assigned الرقم الذي أُعطي للموظف
 * @returns العدّاد التالي، ولا يتجاوز 1000000
 */
export function nextEmployeeNumberCounter(assigned: number): number {
  return Math.min(assigned + 1, 1_000_000);
}

/**
 * يحوّل نصًا مكتوبًا إلى رقم وظيفي، أو null لو مش رقم وظيفي صالح.
 * القاعدة (TD-3، EN-Q8): أرقام فقط بلا مسافة أو إشارة أو فاصلة أو صيغة علمية، والأصفار البادئة تُشال
 * («007» = 7)، والقيمة من 1 إلى 999999. مَن يستدعيها يقص المسافات قبلها لو النص جاي من خانة بحث.
 *
 * @param text النص كما كتبه المستخدم
 * @returns الرقم من 1 إلى 999999، أو null
 */
export function parseEmployeeNumber(text: string): number | null {
  if (!/^[0-9]+$/.test(text)) return null;
  const digits = text.replace(/^0+/, '');
  if (digits.length === 0 || digits.length > 6) return null;
  const value = Number(digits);
  return value >= 1 && value <= EMPLOYEE_NUMBER_MAX ? value : null;
}
