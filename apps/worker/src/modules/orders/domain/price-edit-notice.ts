import { editorLabel, safeDisplayName } from '@pospay/i18n';

/** القاعدة المؤقتة حتى يضيف البند 62 مفاتيح تعطيل التنبيه؛ المحرر لا يُستثنى (ED-Q10). */
export interface PriceEditNoticeRule {
  readonly channel: 'IN_APP';
  readonly roles: readonly string[];
}
/** تسميات الكتالوج المحقونة للخدمة والفرع عند رفض اسمهما؛ تسمية المحرر تأتي من editorLabel. */
export interface PriceEditNameFallback {
  readonly service: { readonly ar: string; readonly en: string };
  readonly branch: { readonly ar: string; readonly en: string };
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
/** اسم المحرر الجاهز للقالب بعد تطبيق قواعد الرجوع. */
export interface PriceEditEditorLabel {
  readonly ar: string;
  readonly en: string;
}
export interface PriceEditEditorSnapshot {
  readonly nameAr: string | null;
  readonly nameEn: string | null;
  readonly role: string | null;
  readonly roleIsSystem: boolean | null;
  readonly roleNameAr: string | null;
  readonly roleNameEn: string | null;
}
export interface PriceEditParameterInput {
  readonly service: { readonly nameAr: string | null; readonly nameEn: string | null };
  readonly branch: { readonly nameAr: string | null; readonly nameEn: string | null };
  readonly businessDate: string;
  readonly previousNet: string;
  readonly newNet: string;
  readonly editor: PriceEditEditorLabel;
  readonly fallback: PriceEditNameFallback;
}
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
  assertPriceEditEventValues(input);
  const service = bilingual(input.service.nameAr, input.service.nameEn, input.fallback.service);
  const branch = bilingual(input.branch.nameAr, input.branch.nameEn, input.fallback.branch);
  return [
    { name: 'service_name_ar', type: 'text', value: service.ar },
    { name: 'service_name_en', type: 'text', value: service.en },
    { name: 'branch_name_ar', type: 'text', value: branch.ar },
    { name: 'branch_name_en', type: 'text', value: branch.en },
    { name: 'business_date', type: 'text', value: input.businessDate },
    { name: 'previous_net', type: 'text', value: input.previousNet },
    { name: 'new_net', type: 'text', value: input.newNet },
    { name: 'editor_name_ar', type: 'text', value: input.editor.ar },
    { name: 'editor_name_en', type: 'text', value: input.editor.en },
  ];
}
function bilingual(
  nameAr: string | null,
  nameEn: string | null,
  fallback: { readonly ar: string; readonly en: string },
) {
  return {
    ar: safeDisplayName(nameAr) ?? safeDisplayName(nameEn) ?? fallback.ar,
    en: safeDisplayName(nameEn) ?? fallback.en,
  };
}
/**
 * يبني اسمي المحرر للقالب من لقطة صف التعديل عبر editorLabel الواحدة؛ لقطة بلا اسم ولا دور (صف قبل ADR-0045) تُرفض
 * حتى لا يظهر محرر مجهول في الجرس.
 *
 * @param editor الاسمان ولقطة الدور كما خُزنت وقت الحفظ
 * @returns الاسم العربي والإنجليزي الجاهزين لمعاملات القالب
 */
export function priceEditEditorLabel(editor: PriceEditEditorSnapshot): PriceEditEditorLabel {
  const hasName = [editor.nameAr, editor.nameEn].some((name) => (name?.trim() ?? '') !== '');
  if (!hasName && editor.role === null) throw new Error('PRICE_EDIT_EVENT_INVALID');
  return { ar: editorLabel('ar', editor), en: editorLabel('en', editor) };
}
/**
 * يرفض تاريخًا غير تقويمي أو مبلغًا غير قانوني قبل حجز دفتر الجرس، حتى لا يُحجز صف لحدث فاسد.
 *
 * @param values القيم الثلاث كنصوص
 * @param values.businessDate تاريخ العمل
 * @param values.previousNet صافي ما قبل التعديل
 * @param values.newNet صافي ما بعد التعديل
 */
export function assertPriceEditEventValues(values: {
  readonly businessDate: string;
  readonly previousNet: string;
  readonly newNet: string;
}): void {
  assertCalendarDate(values.businessDate);
  assertCanonicalMoney(values.previousNet);
  assertCanonicalMoney(values.newNet);
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
