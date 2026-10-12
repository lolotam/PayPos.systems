/** القاعدة المؤقتة حتى يضيف البند 62 مفاتيح تعطيل التنبيه؛ لا إرسال خارجي. */
export interface LateNoticeRule {
  readonly channel: 'IN_APP';
  readonly roles: readonly string[];
}
/** أسماء عامة مترجمة يحقنها جذر الوحدة عند رفض اسم الفرع. */
export interface BranchNameFallback {
  readonly ar: string;
  readonly en: string;
}
/** معاملات العرض الآمنة، دون هوية العميل أو موظفيه. */
export type LateNoticeParameters = [
  { name: 'branch_name_ar'; type: 'text'; value: string },
  { name: 'branch_name_en'; type: 'text'; value: string },
  { name: 'business_date'; type: 'text'; value: string },
];
const UNSAFE_NAME =
  /(?:https?:|[a-z][a-z\d+.-]*:\/\/|\b[a-z\d-]+\.[a-z]{2,}\b|\p{Nd}(?:[\s().+-]*\p{Nd}){6,}|\b(?:bearer|token|otp|code)\b|^\p{Nd}{4,8}$)/iu;

/**
 * يحدد قناة الجرس وأدوار المديرين حسب SS-Q11 وADR-0037.
 *
 * @returns القاعدة الثابتة التي يستبدلها البند 62
 */
export function interimLateNoticeRule(): LateNoticeRule {
  return {
    channel: 'IN_APP',
    roles: ['owner', 'general_manager', 'business_manager', 'branch_manager'],
  };
}
/**
 * يقرأ دليل التأخير المحفوظ دون إعادة حساب التاريخ عند المعالجة.
 *
 * @param saved حقيقة الرأس والبنود المقبولة في الحدث
 * @param saved.late تأخير الرأس المحفوظ
 * @param saved.lines حقائق البنود المقبولة
 * @returns هل يستحق الحدث أول قرار إشعار للزيارة
 */
export function qualifiesForLateNotice(saved: {
  late: boolean;
  lines: readonly { late: boolean }[];
}): boolean {
  return saved.late || saved.lines.some((line) => line.late);
}
/**
 * يرتب المستخدمين ويسقط التكرار ويقسمهم إلى مجموعات عقد الإشعار؛ لا يستثني المسجل.
 *
 * @param userIds مستخدمو المديرين المؤهلين
 * @returns المجموعات التي لا تتجاوز مئة مستلم وعدد المستخدمين بعد حذف التكرار
 */
export function lateNoticeRecipientGroups(userIds: readonly string[]): {
  groups: readonly (readonly string[])[];
  recipientCount: number;
} {
  const unique = [...new Set(userIds)].sort();
  const groups: string[][] = [];
  for (let i = 0; i < unique.length; i += 100) groups.push(unique.slice(i, i + 100));
  return { groups, recipientCount: unique.length };
}
/**
 * يجهز اسم الفرع والتاريخ المحفوظ؛ الاسم المرفوض يرجع للإنجليزي ثم العام المترجم.
 *
 * @param branch أسماء الفرع من التينانسي
 * @param branch.nameAr الاسم العربي أو null
 * @param branch.nameEn الاسم الإنجليزي
 * @param businessDate تاريخ الزيارة المحفوظ
 * @param fallback الأسماء العامة المترجمة
 * @returns معاملات آمنة بالترتيب المطلوب للقالب
 */
export function lateNoticeParameters(
  branch: { nameAr: string | null; nameEn: string },
  businessDate: string,
  fallback: BranchNameFallback,
): LateNoticeParameters {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
    !Number.isFinite(Date.parse(businessDate)) ||
    new Date(businessDate).toISOString().slice(0, 10) !== businessDate
  )
    throw new Error('LATE_SESSION_DATE_INVALID');
  return [
    {
      name: 'branch_name_ar',
      type: 'text',
      value: safeName(branch.nameAr) ?? safeName(branch.nameEn) ?? fallback.ar,
    },
    { name: 'branch_name_en', type: 'text', value: safeName(branch.nameEn) ?? fallback.en },
    { name: 'business_date', type: 'text', value: businessDate },
  ];
}
function safeName(value: string | null): string | null {
  const name = value?.trim() ?? '';
  return name.length > 0 && name.length <= 255 && !UNSAFE_NAME.test(name) ? name : null;
}
