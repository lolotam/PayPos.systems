/** القاعدة المؤقتة حتى يضيف البند 62 مفاتيح تعطيل التنبيه؛ المُلغي لا يُستثنى (LC-11). */
export interface LineCancelNoticeRule {
  readonly channel: 'IN_APP';
  readonly roles: readonly string[];
}
/**
 * تسميات الكتالوج ودالة الاسم الآمن المحقونتان؛ domain لا يستورد i18n فتُحقن safeDisplayName من التوصيل.
 */
export interface LineCancelNameFallback {
  readonly service: { readonly ar: string; readonly en: string };
  readonly branch: { readonly ar: string; readonly en: string };
  readonly safeName: (value: string | null) => string | null;
}
/** ترتيب قالب service_line_cancelled ثابت؛ المبلغ نص بثلاث خانات وليس ناتج تحويل رقمي، وبلا هوية ولا سبب. */
export type LineCancelParameters = [
  { name: 'service_name_ar'; type: 'text'; value: string },
  { name: 'service_name_en'; type: 'text'; value: string },
  { name: 'branch_name_ar'; type: 'text'; value: string },
  { name: 'branch_name_en'; type: 'text'; value: string },
  { name: 'business_date'; type: 'text'; value: string },
  { name: 'cancelled_net'; type: 'text'; value: string },
];
export interface LineCancelParameterInput {
  readonly service: { readonly nameAr: string | null; readonly nameEn: string | null };
  readonly branch: { readonly nameAr: string | null; readonly nameEn: string | null };
  readonly businessDate: string;
  readonly cancelledNet: string;
  readonly fallback: LineCancelNameFallback;
}
const CANONICAL_MONEY = /^(0|[1-9]\d{0,10})\.\d{3}$/;

/**
 * يحدد قناة الجرس وأدوار المديرين الأربعة كما في جرس تعديل السعر.
 *
 * @returns القاعدة الثابتة التي يستبدلها البند 62
 */
export function interimLineCancelNoticeRule(): LineCancelNoticeRule {
  return {
    channel: 'IN_APP',
    roles: ['owner', 'general_manager', 'business_manager', 'branch_manager'],
  };
}
/**
 * يرتب المستخدمين ويسقط التكرار ويقسمهم مجموعات لا تتجاوز مئة؛ صفر مستلمين لا ينتج مجموعة.
 *
 * @param userIds مستخدمو المديرين المؤهلين
 * @returns المجموعات وعدد المستخدمين بعد حذف التكرار
 */
export function lineCancelRecipientGroups(userIds: readonly string[]): {
  groups: readonly (readonly string[])[];
  recipientCount: number;
} {
  const unique = [...new Set(userIds)].sort();
  const groups: string[][] = [];
  for (let i = 0; i < unique.length; i += 100) groups.push(unique.slice(i, i + 100));
  return { groups, recipientCount: unique.length };
}
/**
 * يجهز معاملات القالب من السطر والفرع؛ الاسم المرفوض يرجع للإنجليزي ثم لتسمية الكتالوج، والاسم الإنجليزي لا يرجع للعربي.
 *
 * @param input الأسماء والتاريخ وصافي السطر الملغي والتسميات المحقونة
 * @returns المعاملات الستة بالترتيب الذي يقبله قالب service_line_cancelled
 */
export function lineCancelNoticeParameters(input: LineCancelParameterInput): LineCancelParameters {
  assertLineCancelEventValues(input);
  const service = bilingual(
    input.service.nameAr,
    input.service.nameEn,
    input.fallback.service,
    input.fallback.safeName,
  );
  const branch = bilingual(
    input.branch.nameAr,
    input.branch.nameEn,
    input.fallback.branch,
    input.fallback.safeName,
  );
  return [
    { name: 'service_name_ar', type: 'text', value: service.ar },
    { name: 'service_name_en', type: 'text', value: service.en },
    { name: 'branch_name_ar', type: 'text', value: branch.ar },
    { name: 'branch_name_en', type: 'text', value: branch.en },
    { name: 'business_date', type: 'text', value: input.businessDate },
    { name: 'cancelled_net', type: 'text', value: input.cancelledNet },
  ];
}
function bilingual(
  nameAr: string | null,
  nameEn: string | null,
  fallback: { readonly ar: string; readonly en: string },
  safeName: (value: string | null) => string | null,
) {
  return {
    ar: safeName(nameAr) ?? safeName(nameEn) ?? fallback.ar,
    en: safeName(nameEn) ?? fallback.en,
  };
}
/**
 * يرفض تاريخًا غير تقويمي أو مبلغًا غير قانوني قبل حجز دفتر الجرس، حتى لا يُحجز صف لحدث فاسد.
 *
 * @param values القيم كنصوص
 * @param values.businessDate تاريخ العمل
 * @param values.cancelledNet صافي السطر الملغي
 */
export function assertLineCancelEventValues(values: {
  readonly businessDate: string;
  readonly cancelledNet: string;
}): void {
  assertCalendarDate(values.businessDate);
  assertCanonicalMoney(values.cancelledNet);
}
function assertCanonicalMoney(value: string): void {
  if (!CANONICAL_MONEY.test(value)) throw new Error('LINE_CANCEL_EVENT_INVALID');
}
function assertCalendarDate(businessDate: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
    !Number.isFinite(Date.parse(businessDate)) ||
    new Date(businessDate).toISOString().slice(0, 10) !== businessDate
  )
    throw new Error('LINE_CANCEL_EVENT_INVALID');
}
