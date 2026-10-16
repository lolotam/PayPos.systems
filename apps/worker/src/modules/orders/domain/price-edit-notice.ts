/** القاعدة المؤقتة حتى يضيف البند 62 مفاتيح تعطيل التنبيه؛ المحرر لا يُستثنى (ED-Q10). */
export interface PriceEditNoticeRule {
  readonly channel: 'IN_APP';
  readonly roles: readonly string[];
}
/** تسميات الكتالوج المحقونة: الخدمة والفرع ودور المحرر عند رفض الاسم. */
export interface PriceEditNameFallback {
  readonly service: { readonly ar: string; readonly en: string };
  readonly branch: { readonly ar: string; readonly en: string };
  readonly owner: { readonly ar: string; readonly en: string };
  readonly manager: { readonly ar: string; readonly en: string };
}
/** ترتيب ED-Q11 ثابت؛ المبلغ نص بثلاث خانات وليس ناتج تحويل رقمي. */
export type PriceEditParameters = [
  { name: 'service_name_ar'; type: 'text'; value: string },
  { name: 'service_name_en'; type: 'text'; value: string },
  { name: 'branch_name_ar'; type: 'text'; value: string },
  { name: 'branch_name_en'; type: 'text'; value: string },
  { name: 'business_date'; type: 'text'; value: string },
  { name: 'previous_net'; type: 'text'; value: string },
  { name: 'new_net'; type: 'text'; value: string },
  { name: 'editor_name_ar'; type: 'text'; value: string },
  { name: 'editor_name_en'; type: 'text'; value: string },
];
export interface PriceEditParameterInput {
  readonly service: { readonly nameAr: string | null; readonly nameEn: string | null };
  readonly branch: { readonly nameAr: string | null; readonly nameEn: string | null };
  readonly businessDate: string;
  readonly previousNet: string;
  readonly newNet: string;
  readonly editor: {
    readonly nameAr: string | null;
    readonly nameEn: string | null;
    readonly role: string | null;
  };
  readonly fallback: PriceEditNameFallback;
}
const UNSAFE_NAME =
  /(?:https?:|[a-z][a-z\d+.-]*:\/\/|\b[a-z\d-]+\.[a-z]{2,}\b|\p{Nd}(?:[\s().+-]*\p{Nd}){6,}|\b(?:bearer|token|otp|code)\b|^\p{Nd}{4,8}$)/iu;
const CANONICAL_MONEY = /^(0|[1-9]\d{0,10})\.\d{3}$/;

/**
 * يحدد قناة الجرس وأدوار المديرين الأربعة كما في جرس التأخير.
 *
 * @returns القاعدة الثابتة التي يستبدلها البند 62
 */
export function interimPriceEditNoticeRule(): PriceEditNoticeRule {
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
export function priceEditRecipientGroups(userIds: readonly string[]): {
  groups: readonly (readonly string[])[];
  recipientCount: number;
} {
  const unique = [...new Set(userIds)].sort();
  const groups: string[][] = [];
  for (let i = 0; i < unique.length; i += 100) groups.push(unique.slice(i, i + 100));
  return { groups, recipientCount: unique.length };
}
/**
 * يجهز معاملات القالب من لقطة التعديل؛ الاسم المرفوض يرجع للإنجليزي ثم لتسمية الكتالوج، والاسم الإنجليزي لا يرجع للعربي.
 *
 * @param input الأسماء والتاريخ والمبالغ ولقطة المحرر والتسميات المحقونة
 * @returns المعاملات التسعة بالترتيب الذي يقبله قالب service_line_price_edited
 */
export function priceEditNoticeParameters(input: PriceEditParameterInput): PriceEditParameters {
  assertCalendarDate(input.businessDate);
  assertCanonicalMoney(input.previousNet);
  assertCanonicalMoney(input.newNet);
  const service = bilingual(input.service.nameAr, input.service.nameEn, input.fallback.service);
  const branch = bilingual(input.branch.nameAr, input.branch.nameEn, input.fallback.branch);
  const editor = editorNames(input.editor, input.fallback);
  return [
    { name: 'service_name_ar', type: 'text', value: service.ar },
    { name: 'service_name_en', type: 'text', value: service.en },
    { name: 'branch_name_ar', type: 'text', value: branch.ar },
    { name: 'branch_name_en', type: 'text', value: branch.en },
    { name: 'business_date', type: 'text', value: input.businessDate },
    { name: 'previous_net', type: 'text', value: input.previousNet },
    { name: 'new_net', type: 'text', value: input.newNet },
    { name: 'editor_name_ar', type: 'text', value: editor.ar },
    { name: 'editor_name_en', type: 'text', value: editor.en },
  ];
}
function bilingual(
  nameAr: string | null,
  nameEn: string | null,
  fallback: { readonly ar: string; readonly en: string },
) {
  return {
    ar: safeName(nameAr) ?? safeName(nameEn) ?? fallback.ar,
    en: safeName(nameEn) ?? fallback.en,
  };
}
function editorNames(
  editor: PriceEditParameterInput['editor'],
  fallback: PriceEditNameFallback,
): { ar: string; en: string } {
  const role =
    editor.role === 'owner' ? fallback.owner : editor.role === 'manager' ? fallback.manager : null;
  const en = safeName(editor.nameEn) ?? role?.en ?? null;
  const ar = safeName(editor.nameAr) ?? safeName(editor.nameEn) ?? role?.ar ?? null;
  if (ar === null || en === null) throw new Error('PRICE_EDIT_EVENT_INVALID');
  return { ar, en };
}
function assertCanonicalMoney(value: string): void {
  if (!CANONICAL_MONEY.test(value)) throw new Error('PRICE_EDIT_EVENT_INVALID');
}
function assertCalendarDate(businessDate: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
    !Number.isFinite(Date.parse(businessDate)) ||
    new Date(businessDate).toISOString().slice(0, 10) !== businessDate
  )
    throw new Error('PRICE_EDIT_EVENT_INVALID');
}
function safeName(value: string | null): string | null {
  const name = value?.trim() ?? '';
  return name.length > 0 && name.length <= 255 && !UNSAFE_NAME.test(name) ? name : null;
}
