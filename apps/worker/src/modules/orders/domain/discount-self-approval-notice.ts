import {
  bilingual,
  discountApprovalRecipientGroups,
  maxPercentText,
} from './discount-approval-notice.ts';

/** تسميات الكتالوج والموافِق البديلة ودالة الاسم الآمن؛ تُحقن من التوصيل حتى يبقى domain خالصاً. */
export interface DiscountSelfApprovalNoticeNameFallback {
  readonly service: { readonly ar: string; readonly en: string };
  readonly branch: { readonly ar: string; readonly en: string };
  readonly approver: { readonly ar: string; readonly en: string };
  readonly safeName: (value: string | null) => string | null;
}

/** ترتيب قالب discount_self_approved ثابت؛ بلا اسم عميل ولا هاتف ولا الطالبة. */
export type DiscountSelfApprovalNoticeParameters = [
  { name: 'branch_name_ar'; type: 'text'; value: string },
  { name: 'branch_name_en'; type: 'text'; value: string },
  { name: 'approver_name_ar'; type: 'text'; value: string },
  { name: 'approver_name_en'; type: 'text'; value: string },
  { name: 'service_name_ar'; type: 'text'; value: string },
  { name: 'service_name_en'; type: 'text'; value: string },
  { name: 'max_percent'; type: 'text'; value: string },
];

/** قيم الاقتراح اللازمة لقواعد الجرس: هويته ونسبته الفعلية المعلنة في الحدث. */
export interface SelfApprovalProposalValues {
  readonly id: string;
  readonly effectiveBps: number;
}

/** مدخلات معاملات الجرس: لقطات الأسماء وأعلى نسبة والتسميات البديلة المحقونة. */
export interface DiscountSelfApprovalParameterInput {
  readonly branch: { readonly nameAr: string | null; readonly nameEn: string };
  readonly approver: { readonly labelAr: string; readonly labelEn: string };
  readonly service: { readonly nameAr: string | null; readonly nameEn: string };
  readonly maxEffectiveBps: number;
  readonly fallback: DiscountSelfApprovalNoticeNameFallback;
}

/**
 * يتحقق من اقتراحات حدث الموافقة على عمل الموافِق قبل حجز دفتر الجرس، حتى لا يُحجز صف لحدث فاسد.
 * الحدث يحمل من 1 إلى 20 اقتراحاً بمعرفات فريدة، وكل نسبة عدد صحيح بين 1 و10000 نقطة أساس.
 *
 * @param proposals الاقتراحات الموسومة في الحدث
 * @param proposals[].id معرف الاقتراح المخزن
 * @param proposals[].effectiveBps نسبة الخصم الفعلية بالنقاط الأساس
 * @returns لا شيء عند صلاحية الحدث؛ وإلا يرمي DISCOUNT_SELF_APPROVAL_EVENT_INVALID
 */
export function assertDiscountSelfApprovalEventValues(
  proposals: readonly SelfApprovalProposalValues[],
): void {
  if (proposals.length < 1 || proposals.length > 20)
    throw new Error('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  if (new Set(proposals.map((proposal) => proposal.id)).size !== proposals.length)
    throw new Error('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  for (const proposal of proposals) assertEffectiveBps(proposal.effectiveBps);
}

/**
 * يحسب أكبر نسبة خصم بين الاقتراحات الموسومة، لأن الجرس يعرض سقف القرار لا نسبة خدمة واحدة قد تكون أقل.
 *
 * @param proposals الاقتراحات الموسومة في الحدث
 * @param proposals[].id معرف الاقتراح المخزن
 * @param proposals[].effectiveBps نسبة الخصم الفعلية بالنقاط الأساس
 * @returns أكبر effectiveBps بعد التحقق من الحدث كاملاً
 */
export function maxSelfApprovalEffectiveBps(
  proposals: readonly SelfApprovalProposalValues[],
): number {
  assertDiscountSelfApprovalEventValues(proposals);
  return Math.max(...proposals.map((proposal) => proposal.effectiveBps));
}

/**
 * يعيد استخدام تقسيم مستلمي جرس الموافقة: ترتيب وإسقاط تكرار ومجموعات لا تتجاوز مئة.
 * الموافِق المالك لا يُستبعد من مستلميه (DA-Q10)، وهذه الدالة لا تعرف أصلاً من وافق.
 *
 * @param userIds معرفات المستخدمين المؤهلين بقاعدة التنبيه الفعلية
 * @returns المجموعات وعدد المستخدمين بعد حذف التكرار؛ صفر مستلمين يعطي صفر مجموعات
 */
export function discountSelfApprovalRecipientGroups(userIds: readonly string[]): {
  groups: readonly (readonly string[])[];
  recipientCount: number;
} {
  return discountApprovalRecipientGroups(userIds);
}

/**
 * يجهز معاملات قالب discount_self_approved بترتيبه السبعي الثابت وبلا بيانات عميل أو طالبة.
 * العربي يرجع للإنجليزي ثم للتسمية البديلة، والإنجليزي لا يرجع للعربي؛ والنسبة تُحسب من bps بلا أصفار زائدة.
 *
 * @param input لقطات الأسماء وأعلى نسبة والتسميات المحقونة
 * @param input.branch.nameAr اسم الفرع العربي إن وُجد
 * @param input.branch.nameEn اسم الفرع الإنجليزي
 * @param input.approver.labelAr تسمية الموافِق العربية وقت القرار
 * @param input.approver.labelEn تسمية الموافِق الإنجليزية وقت القرار
 * @param input.service.nameAr اسم الخدمة العربي إن وُجد
 * @param input.service.nameEn اسم الخدمة الإنجليزي
 * @param input.maxEffectiveBps أكبر نسبة خصم بالنقاط الأساس
 * @param input.fallback التسميات البديلة ودالة الاسم الآمن
 * @param input.fallback.service بديل اسم الخدمة بالعربية والإنجليزية
 * @param input.fallback.branch بديل اسم الفرع بالعربية والإنجليزية
 * @param input.fallback.approver بديل تسمية الموافِق بالعربية والإنجليزية
 * @param input.fallback.safeName دالة قبول الاسم الآمن المحقونة من التوصيل
 * @returns المعاملات السبعة بالترتيب الذي يقبله القالب، أو يرمي DISCOUNT_SELF_APPROVAL_EVENT_INVALID لنسبة فاسدة
 */
export function selfApprovalNoticeParameters(
  input: DiscountSelfApprovalParameterInput,
): DiscountSelfApprovalNoticeParameters {
  assertEffectiveBps(input.maxEffectiveBps);
  const branch = bilingual(
    input.branch.nameAr,
    input.branch.nameEn,
    input.fallback.branch,
    input.fallback.safeName,
  );
  const approver = bilingual(
    input.approver.labelAr,
    input.approver.labelEn,
    input.fallback.approver,
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
    { name: 'approver_name_ar', type: 'text', value: approver.ar },
    { name: 'approver_name_en', type: 'text', value: approver.en },
    { name: 'service_name_ar', type: 'text', value: service.ar },
    { name: 'service_name_en', type: 'text', value: service.en },
    { name: 'max_percent', type: 'text', value: maxPercentText(input.maxEffectiveBps) },
  ];
}

function assertEffectiveBps(effectiveBps: number): void {
  if (!Number.isInteger(effectiveBps) || effectiveBps < 1 || effectiveBps > 10000)
    throw new Error('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
}
