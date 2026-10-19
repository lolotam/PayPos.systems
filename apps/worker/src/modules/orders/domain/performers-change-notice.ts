/** القاعدة المؤقتة حتى يضيف البند 62 مفاتيح تعطيل التنبيه؛ من غيّر المنفّذين لا يُستثنى. */
export interface PerformersChangeNoticeRule {
  readonly channel: 'IN_APP';
  readonly roles: readonly string[];
}
/**
 * تسميات الكتالوج ودالة الاسم الآمن المحقونتان؛ domain لا يستورد i18n فتُحقن safeDisplayName من التوصيل.
 */
export interface PerformersChangeNameFallback {
  readonly service: { readonly ar: string; readonly en: string };
  readonly branch: { readonly ar: string; readonly en: string };
  readonly safeName: (value: string | null) => string | null;
}
/** ترتيب قالب service_line_performers_changed ثابت؛ المبلغ نص بثلاث خانات وليس ناتج تحويل رقمي، وبلا سبب ولا اسم منفّذ ولا هوية من غيّر. */
export type PerformersChangeParameters = [
  { name: 'service_name_ar'; type: 'text'; value: string },
  { name: 'service_name_en'; type: 'text'; value: string },
  { name: 'branch_name_ar'; type: 'text'; value: string },
  { name: 'branch_name_en'; type: 'text'; value: string },
  { name: 'business_date'; type: 'text'; value: string },
  { name: 'line_net'; type: 'text'; value: string },
];
/** مدخلات معاملات الجرس: أسماء الخدمة والفرع المحفوظة وتاريخ الزيارة وصافي السطر من الحدث، بلا سبب ولا اسم منفّذ ولا هوية من غيّر. */
export interface PerformersChangeParameterInput {
  readonly service: { readonly nameAr: string | null; readonly nameEn: string | null };
  readonly branch: { readonly nameAr: string | null; readonly nameEn: string | null };
  readonly businessDate: string;
  readonly lineNet: string;
  readonly fallback: PerformersChangeNameFallback;
}
/** حصة منفّذ واحدة كما في الحدث وصفوف التاريخ؛ الاسم غير موجود هنا حتى لا يدخل الجرس. */
export interface PerformerShare {
  readonly employee_id: string;
  readonly share_bps: number;
}
/** رأس التغيير وصفّاه بالترتيب، بلا سبب ولا هوية من غيّر. */
export interface PerformersChangeHistory {
  readonly previousRevision: number;
  readonly before: readonly PerformerShare[];
  readonly after: readonly PerformerShare[];
}
/** ما يُقارن بالتاريخ: المراجعة السابقة وصفّا قبل وبعد بالترتيب الذي أعلنه الحدث. */
export interface PerformersChangeHistoryEvent {
  readonly previousRevision: number;
  readonly previousPerformers: readonly PerformerShare[];
  readonly performers: readonly PerformerShare[];
}
const CANONICAL_MONEY = /^(0|[1-9]\d{0,10})\.\d{3}$/;

/**
 * يحدد قناة الجرس وأدوار المديرين الأربعة كما في جرس الإلغاء.
 *
 * @returns القاعدة الثابتة التي يستبدلها البند 62
 */
export function interimPerformersChangeNoticeRule(): PerformersChangeNoticeRule {
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
export function performersChangeRecipientGroups(userIds: readonly string[]): {
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
 * @param input الأسماء والتاريخ وصافي السطر والتسميات المحقونة
 * @returns المعاملات الستة بالترتيب الذي يقبله قالب service_line_performers_changed
 */
export function performersChangeNoticeParameters(
  input: PerformersChangeParameterInput,
): PerformersChangeParameters {
  assertPerformersChangeEventValues(input);
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
    { name: 'line_net', type: 'text', value: input.lineNet },
  ];
}
/**
 * يقبل الحدث فقط إذا طابق رأس التغيير وصفّي قبل وبعد بالترتيب؛ مجموعة مختلفة أو مراجعة سابقة مختلفة جرس لحدث آخر.
 *
 * @param history الرأس والصفوف المقروءة، أو null إذا غاب الرأس
 * @param event المراجعة السابقة والمنفّذون كما أعلنهم الحدث
 * @returns هل التاريخ هو نفسه تغيير هذا الحدث
 */
export function performersChangeMatchesHistory(
  history: PerformersChangeHistory | null,
  event: PerformersChangeHistoryEvent,
): boolean {
  if (history === null) return false;
  return (
    history.previousRevision === event.previousRevision &&
    samePerformers(history.before, event.previousPerformers) &&
    samePerformers(history.after, event.performers)
  );
}
/**
 * يرفض تاريخًا غير تقويمي أو مبلغًا غير قانوني قبل حجز دفتر الجرس، حتى لا يُحجز صف لحدث فاسد.
 * صافي السطر يُؤخذ من الحدث نفسه؛ إعادة تسعير لاحقة لا تُسقط الجرس.
 *
 * @param values القيم كنصوص
 * @param values.businessDate تاريخ العمل
 * @param values.lineNet صافي السطر في الحدث
 */
export function assertPerformersChangeEventValues(values: {
  readonly businessDate: string;
  readonly lineNet: string;
}): void {
  assertCalendarDate(values.businessDate);
  assertCanonicalMoney(values.lineNet);
}
function samePerformers(
  stored: readonly PerformerShare[],
  announced: readonly PerformerShare[],
): boolean {
  return (
    stored.length === announced.length &&
    stored.every(
      (row, index) =>
        row.employee_id === announced[index]?.employee_id &&
        row.share_bps === announced[index]?.share_bps,
    )
  );
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
function assertCanonicalMoney(value: string): void {
  if (!CANONICAL_MONEY.test(value)) throw new Error('LINE_PERFORMERS_EVENT_INVALID');
}
function assertCalendarDate(businessDate: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
    !Number.isFinite(Date.parse(businessDate)) ||
    new Date(businessDate).toISOString().slice(0, 10) !== businessDate
  )
    throw new Error('LINE_PERFORMERS_EVENT_INVALID');
}
