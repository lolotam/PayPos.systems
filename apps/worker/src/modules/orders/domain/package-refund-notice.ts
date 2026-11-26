/**
 * تسميات الكتالوج ودالة الاسم الآمن المحقونتان؛ domain لا يستورد i18n فتُحقن safeDisplayName من التوصيل.
 */
export interface PackageRefundNameFallback {
  readonly packageName: { readonly ar: string; readonly en: string };
  readonly branch: { readonly ar: string; readonly en: string };
  readonly safeName: (value: string | null) => string | null;
}

/** ترتيب قالب package_refund_recorded ثابت؛ المبلغ نص بثلاث خانات وليس ناتج تحويل رقمي، وبلا سبب ولا اسم عميل. */
export type PackageRefundParameters = [
  { name: 'package_name_ar'; type: 'text'; value: string },
  { name: 'package_name_en'; type: 'text'; value: string },
  { name: 'branch_name_ar'; type: 'text'; value: string },
  { name: 'branch_name_en'; type: 'text'; value: string },
  { name: 'sessions'; type: 'text'; value: string },
  { name: 'amount'; type: 'text'; value: string },
  { name: 'business_date'; type: 'text'; value: string },
];

/** مدخلات معاملات جرس الاسترداد: أسماء الباقة والفرع وعدد الجلسات والمبلغ والتاريخ، بلا سبب ولا اسم عميل. */
export interface PackageRefundParameterInput {
  readonly packageName: { readonly nameAr: string | null; readonly nameEn: string | null };
  readonly branch: { readonly nameAr: string | null; readonly nameEn: string | null };
  readonly sessions: number;
  readonly amount: string;
  readonly businessDate: string;
  readonly fallback: PackageRefundNameFallback;
}

const CANONICAL_MONEY = /^(0|[1-9]\d{0,10})\.\d{3}$/;

/**
 * يرتب المستخدمين ويسقط التكرار ويقسمهم مجموعات لا تتجاوز مئة؛ صفر مستلمين لا ينتج مجموعة.
 *
 * @param userIds مستخدمو المديرين المؤهلين
 * @returns المجموعات وعدد المستخدمين بعد حذف التكرار
 */
export function packageRefundRecipientGroups(userIds: readonly string[]): {
  groups: readonly (readonly string[])[];
  recipientCount: number;
} {
  const unique = [...new Set(userIds)].sort();
  const groups: string[][] = [];
  for (let i = 0; i < unique.length; i += 100) groups.push(unique.slice(i, i + 100));
  return { groups, recipientCount: unique.length };
}

/**
 * يجهز معاملات القالب من الباقة والفرع؛ الاسم المرفوض يرجع للإنجليزي ثم لتسمية الكتالوج، والاسم الإنجليزي لا يرجع للعربي.
 *
 * @param input الأسماء وعدد الجلسات والمبلغ والتاريخ والتسميات المحقونة
 * @returns المعاملات السبعة بالترتيب الذي يقبله قالب package_refund_recorded
 */
export function packageRefundNoticeParameters(
  input: PackageRefundParameterInput,
): PackageRefundParameters {
  assertPackageRefundEventValues({
    businessDate: input.businessDate,
    amount: input.amount,
    sessions: input.sessions,
  });
  const packageName = bilingual(
    input.packageName.nameAr,
    input.packageName.nameEn,
    input.fallback.packageName,
    input.fallback.safeName,
  );
  const branch = bilingual(
    input.branch.nameAr,
    input.branch.nameEn,
    input.fallback.branch,
    input.fallback.safeName,
  );
  return [
    { name: 'package_name_ar', type: 'text', value: packageName.ar },
    { name: 'package_name_en', type: 'text', value: packageName.en },
    { name: 'branch_name_ar', type: 'text', value: branch.ar },
    { name: 'branch_name_en', type: 'text', value: branch.en },
    { name: 'sessions', type: 'text', value: String(input.sessions) },
    { name: 'amount', type: 'text', value: input.amount },
    { name: 'business_date', type: 'text', value: input.businessDate },
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
 * يرفض تاريخًا غير تقويمي أو مبلغًا غير قانوني أو عدد جلسات خارج المدى قبل حجز دفتر الجرس،
 * حتى لا يُحجز صف لحدث فاسد.
 *
 * @param values القيم كنصوص
 * @param values.businessDate تاريخ العمل
 * @param values.amount المبلغ المسترد
 * @param values.sessions عدد الجلسات المستردة
 */
export function assertPackageRefundEventValues(values: {
  readonly businessDate: string;
  readonly amount: string;
  readonly sessions: number;
}): void {
  assertCalendarDate(values.businessDate);
  assertCanonicalMoney(values.amount);
  if (!Number.isInteger(values.sessions) || values.sessions < 1 || values.sessions > 365)
    throw new Error('PACKAGE_REFUND_EVENT_INVALID');
}

function assertCanonicalMoney(value: string): void {
  if (!CANONICAL_MONEY.test(value)) throw new Error('PACKAGE_REFUND_EVENT_INVALID');
}

function assertCalendarDate(businessDate: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
    !Number.isFinite(Date.parse(businessDate)) ||
    new Date(businessDate).toISOString().slice(0, 10) !== businessDate
  )
    throw new Error('PACKAGE_REFUND_EVENT_INVALID');
}
