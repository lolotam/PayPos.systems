/**
 * تسميات الكتالوج ودالة الاسم الآمن المحقونتان؛ domain لا يستورد i18n فتُحقن safeDisplayName من التوصيل.
 */
export interface DiscountApprovalNoticeNameFallback {
  readonly service: { readonly ar: string; readonly en: string };
  readonly branch: { readonly ar: string; readonly en: string };
  readonly safeName: (value: string | null) => string | null;
}
/** ترتيب قالب discount_approval_requested ثابت؛ النسبة نص بلا أصفار زائدة، وبلا اسم عميل ولا هاتف ولا الطالبة. */
export type DiscountApprovalNoticeParameters = [
  { name: 'branch_name_ar'; type: 'text'; value: string },
  { name: 'branch_name_en'; type: 'text'; value: string },
  { name: 'service_name_ar'; type: 'text'; value: string },
  { name: 'service_name_en'; type: 'text'; value: string },
  { name: 'line_count'; type: 'text'; value: string },
  { name: 'max_percent'; type: 'text'; value: string },
];
/** مدخلات معاملات الجرس: أسماء الفرع والخدمة من الحدث والمكان، وعدد السطور وأعلى نسبة من الحدث. */
export interface DiscountApprovalParameterInput {
  readonly branch: { readonly nameAr: string | null; readonly nameEn: string };
  readonly service: { readonly nameAr: string | null; readonly nameEn: string };
  readonly lineCount: number;
  readonly maxEffectiveBps: number;
  readonly serviceCount: number;
  readonly fallback: DiscountApprovalNoticeNameFallback;
}
/** النص المقبول للنسبة في قالب الجرس؛ bps الخام أربعة أرقام يرفضه فلتر الأمان. */
const PERCENT_TEXT = /^(?:100|[1-9]?\d(?:\.\d?[1-9])?)$/;

/**
 * يحوّل نسبة الخصم إلى نص بلا أصفار زائدة: bps مئة كاملة من النسبة، لا نسبة عشرية عائمة.
 * القيم 1 و5 و10 و100 و2000 و2050 و2055 و10000 تعطي 0.01 و0.05 و0.1 و1 و20 و20.5 و20.55 و100.
 *
 * @param bps نسبة الخصم بالنقاط الأساس (1..10000)
 * @returns نسبة مئوية نصية تقبلها قالب الجرس
 */
export function maxPercentText(bps: number): string {
  if (!Number.isInteger(bps) || bps < 1 || bps > 10000)
    throw new Error('DISCOUNT_APPROVAL_EVENT_INVALID');
  // حساب صحيح فقط: المئات من bps والباقي، فلا تمر نسبة عشرية في النص.
  const whole = Math.floor(bps / 100);
  const rest = bps % 100;
  const text = rest === 0 ? String(whole) : `${whole}.${fractionDigits(rest)}`;
  if (text === '0' || !PERCENT_TEXT.test(text)) throw new Error('DISCOUNT_APPROVAL_EVENT_INVALID');
  return text;
}
/**
 * خانتان يُشال منهما صفر واحد فقط حين تكون الخانة الثانية صفراً: 50 تصبح 5 و10 تصبح 1.
 *
 * @param rest بقية bps بعد المئات (1..99)
 * @returns خانتا الجزء العشري بلا أصفار زائدة
 */
function fractionDigits(rest: number): string {
  const digits = String(rest).padStart(2, '0');
  return digits.endsWith('0') ? digits.slice(0, -1) : digits;
}

/**
 * يرتب المستخدمين ويسقط التكرار ويقسمهم مجموعات لا تتجاوز مئة؛ صفر مستلمين لا ينتج مجموعة.
 *
 * @param userIds مستخدمو الموافقين المؤهلين بعد إسقاط الطالبة
 * @returns المجموعات وعدد المستخدمين بعد حذف التكرار
 */
export function discountApprovalRecipientGroups(userIds: readonly string[]): {
  groups: readonly (readonly string[])[];
  recipientCount: number;
} {
  const unique = [...new Set(userIds)].sort();
  const groups: string[][] = [];
  for (let index = 0; index < unique.length; index += 100)
    groups.push(unique.slice(index, index + 100));
  return { groups, recipientCount: unique.length };
}

/**
 * يجهز معاملات القالب من الحدث والمكان؛ الاسم المرفوض يرجع للإنجليزي ثم لتسمية الكتالوج، والاسم الإنجليزي لا يرجع للعربي.
 *
 * @param input أسماء الفرع والخدمة وعدد السطور وأعلى نسبة والتسميات المحقونة
 * @returns المعاملات الستة بالترتيب الذي يقبله قالب discount_approval_requested
 */
export function discountApprovalNoticeParameters(
  input: DiscountApprovalParameterInput,
): DiscountApprovalNoticeParameters {
  assertDiscountApprovalEventValues(input);
  const branch = bilingual(
    input.branch.nameAr,
    input.branch.nameEn,
    input.fallback.branch,
    input.fallback.safeName,
  );
  const service = bilingual(
    input.service.nameAr,
    input.service.nameEn,
    input.fallback.service,
    input.fallback.safeName,
  );
  return [
    { name: 'branch_name_ar', type: 'text', value: branch.ar },
    { name: 'branch_name_en', type: 'text', value: branch.en },
    { name: 'service_name_ar', type: 'text', value: service.ar },
    { name: 'service_name_en', type: 'text', value: service.en },
    { name: 'line_count', type: 'text', value: String(input.lineCount) },
    { name: 'max_percent', type: 'text', value: maxPercentText(input.maxEffectiveBps) },
  ];
}

/**
 * يرفض قيم الحدث غير القانونية قبل حجز دفتر الجرس، حتى لا يُحجز صف لحدث فاسد.
 * عدد الخدمات لا يتجاوز عدد السطور، والنسبة بين 1 و10000 نقطة أساس.
 *
 * @param values عدد السطور وأعلى نسبة وعدد الخدمات في الحدث
 * @param values.lineCount عدد سطور الطلب المعلنة
 * @param values.maxEffectiveBps أعلى نسبة معلنة بالنقاط الأساس
 * @param values.serviceCount عدد الخدمات المميّزة في الحدث
 */
export function assertDiscountApprovalEventValues(values: {
  readonly lineCount: number;
  readonly maxEffectiveBps: number;
  readonly serviceCount: number;
}): void {
  if (!Number.isInteger(values.lineCount) || values.lineCount < 1 || values.lineCount > 20)
    throw new Error('DISCOUNT_APPROVAL_EVENT_INVALID');
  if (
    !Number.isInteger(values.maxEffectiveBps) ||
    values.maxEffectiveBps < 1 ||
    values.maxEffectiveBps > 10000
  )
    throw new Error('DISCOUNT_APPROVAL_EVENT_INVALID');
  if (
    !Number.isInteger(values.serviceCount) ||
    values.serviceCount < 1 ||
    values.serviceCount > values.lineCount
  )
    throw new Error('DISCOUNT_APPROVAL_EVENT_INVALID');
}
function bilingual(
  nameAr: string | null,
  nameEn: string,
  fallback: { readonly ar: string; readonly en: string },
  safeName: (value: string | null) => string | null,
) {
  return {
    ar: safeName(nameAr) ?? safeName(nameEn) ?? fallback.ar,
    en: safeName(nameEn) ?? fallback.en,
  };
}
