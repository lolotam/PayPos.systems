import { maxPercentText } from './discount-approval-notice.ts';

/**
 * تسميات الكتالوج ودالة الاسم الآمن وتسمية الموافِق العامة المحقونة؛ domain لا يستورد i18n فتُحقن من التوصيل.
 * تسمية الموافِق العامة تعيد مفتاح inApp.editor_generic الموجود («مستخدم» / "User")، فلا مفاتيح i18n جديدة.
 */
export interface DiscountSelfApprovalNoticeNameFallback {
  readonly service: { readonly ar: string; readonly en: string };
  readonly branch: { readonly ar: string; readonly en: string };
  readonly approver: { readonly ar: string; readonly en: string };
  readonly safeName: (value: string | null) => string | null;
}
/** ترتيب قالب discount_self_approved ثابت: الفرع، ثم الموافِق، ثم الخدمة، ثم أعلى نسبة. */
export type DiscountSelfApprovalNoticeParameters = [
  { name: 'branch_name_ar'; type: 'text'; value: string },
  { name: 'branch_name_en'; type: 'text'; value: string },
  { name: 'approver_name_ar'; type: 'text'; value: string },
  { name: 'approver_name_en'; type: 'text'; value: string },
  { name: 'service_name_ar'; type: 'text'; value: string },
  { name: 'service_name_en'; type: 'text'; value: string },
  { name: 'max_percent'; type: 'text'; value: string },
];
/** نسبة خصم مقترح ومعرّفه كما أعلنه الحدث؛ القراءة الحالية للمنفّذ أو الصلاحيات خارج اهتمام الجرس. */
export interface SelfApprovalProposalValues {
  readonly id: string;
  readonly effectiveBps: number;
}
/** مدخلات معاملات الجرس: أسماء الفرع والخدمة من الحدث والمكان، ولقطة تسمية الموافِق من الحدث، وأعلى نسبة من المقترحات. */
export interface DiscountSelfApprovalParameterInput {
  readonly branch: { readonly nameAr: string | null; readonly nameEn: string };
  readonly approver: { readonly labelAr: string; readonly labelEn: string };
  readonly service: { readonly nameAr: string | null; readonly nameEn: string };
  readonly maxEffectiveBps: number;
  readonly fallback: DiscountSelfApprovalNoticeNameFallback;
}

/**
 * يحوّل أعلى نسبة خصم إلى نص القالب معاداً استخدام دفتر طلب الموافقة؛ الرفض هنا برمز جرس الموافقة الذاتية.
 * الاستدعاء بعد assert يجعل السقوط مستحيلاً، والتغليف يثبت رمز الخطأ حتى عند النداء المباشر في الاختبارات.
 *
 * @param bps أعلى نسبة خصم بالنقاط الأساس (1..10000)
 * @returns نسبة مئوية نصية تقبلها قالب الجرس
 */
export function selfApprovalMaxPercentText(bps: number): string {
  try {
    return maxPercentText(bps);
  } catch {
    throw new Error('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  }
}

/**
 * يحسب أعلى نسبة بين المقترحات الموسومة؛ الحساب هنا لا في حالة الاستخدام حتى لا تعيش حسابات في التوصيل.
 *
 * @param proposals المقترحات الموسومة كما أعلنها الحدث بعد التحقق
 * @returns أعلى effective_bps بينها
 */
export function maxSelfApprovalEffectiveBps(
  proposals: readonly SelfApprovalProposalValues[],
): number {
  return proposals.reduce((max, proposal) => Math.max(max, proposal.effectiveBps), 0);
}

/**
 * يرتب المستخدمين ويسقط التكرار ويقسمهم مجموعات لا تتجاوز مئة؛ صفر مستلمين لا ينتج مجموعة.
 * الترتيب ثابت لأن ترتيب السلاسل هو ترتيب Postgres في استعلام المستلمين.
 *
 * @param userIds مستخدمو الأدوار المؤهلين؛ الموافِق غير مستبعد (DA-Q10)
 * @returns المجموعات وعدد المستخدمين بعد حذف التكرار
 */
export function discountSelfApprovalRecipientGroups(userIds: readonly string[]): {
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
 * يجهز معاملات القالب السبعة من الحدث والمكان؛ لقطة تسمية الموافِق من الحدث المُتحقق،
 * والاسم المرفوض يعود لتسمية inApp.editor_generic، والإنجليزي لا يرجع للعربي.
 *
 * @param input أسماء الفرع والخدمة ولقطة الموافِق وأعلى نسبة والتسميات المحقونة
 * @returns المعاملات السبعة بالترتيب الذي يقبله قالب discount_self_approved
 */
export function selfApprovalNoticeParameters(
  input: DiscountSelfApprovalParameterInput,
): DiscountSelfApprovalNoticeParameters {
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
  const approver = approverLabel(input);
  return [
    { name: 'branch_name_ar', type: 'text', value: branch.ar },
    { name: 'branch_name_en', type: 'text', value: branch.en },
    { name: 'approver_name_ar', type: 'text', value: approver.ar },
    { name: 'approver_name_en', type: 'text', value: approver.en },
    { name: 'service_name_ar', type: 'text', value: service.ar },
    { name: 'service_name_en', type: 'text', value: service.en },
    { name: 'max_percent', type: 'text', value: selfApprovalMaxPercentText(input.maxEffectiveBps) },
  ];
}

/**
 * يرفض قيم الحدث غير القانونية قبل حجز دفتر الجرس، حتى لا يُحجز صف لحدث فاسد.
 * كل مقترح نسبة صحيحة بين 1 و10000 نقطة أساس، والعدد بين 1 و20، والمعرّفات بلا تكرار.
 *
 * @param proposals المقترحات الموسومة كما أعلنها الحدث
 */
export function assertDiscountSelfApprovalEventValues(
  proposals: readonly SelfApprovalProposalValues[],
): void {
  if (proposals.length < 1 || proposals.length > 20)
    throw new Error('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  if (new Set(proposals.map((proposal) => proposal.id)).size !== proposals.length)
    throw new Error('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  for (const proposal of proposals)
    if (
      !Number.isInteger(proposal.effectiveBps) ||
      proposal.effectiveBps < 1 ||
      proposal.effectiveBps > 10000
    )
      throw new Error('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
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

function approverLabel(input: DiscountSelfApprovalParameterInput): { ar: string; en: string } {
  const safe = input.fallback.safeName;
  return {
    ar: safe(input.approver.labelAr) ?? safe(input.approver.labelEn) ?? input.fallback.approver.ar,
    en: safe(input.approver.labelEn) ?? input.fallback.approver.en,
  };
}
