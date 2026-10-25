import { DiscountApprovalError } from './discount-approval-error.ts';
import { needsApproval, proposalExpiry } from './discount-approval-rules.ts';
import { firstName } from './discount-first-name.ts';
import {
  buildDiscountTerms,
  canonicalDiscountTerms,
  discountTermsHash,
  type DiscountTermsV1,
} from './discount-terms.ts';
import { SessionError } from './session-error.ts';
import type { PreparedSessionLine, SessionLimit } from './session-types.ts';

/** لقطة دور العضوية الطالبة؛ نفس شكل `SessionEditorRole` في `ports/` لأن الـ domain لا يستورد من `ports/`. */
export interface DiscountRequesterRole {
  code: string;
  is_system: boolean;
  name_ar: string | null;
  name_en: string;
}

/** عضوية الطالبة ودورها وقت الطلب؛ الترتيب هو ترتيب `membership_ids`. */
export interface DiscountRequesterMembership {
  membership_id: string;
  role: DiscountRequesterRole;
}

/** منفّذ البند وقت الطلب: لقطة الاسم الأول ورابط المستخدم وقت الطلب (D-16، D-18). */
export interface DiscountProposalPerformer {
  id: string;
  employee_id: string;
  linked_user_id: string | null;
  first_name_en: string;
  first_name_ar: string | null;
}

/** اقتراح واحد جاهز للتخزين: كل ما يكتبه صف `discount_proposals` وصفوف منفّذيه. */
export interface DiscountProposalPlan {
  id: string;
  request_id: string;
  input_index: number;
  session_id: string | null;
  occurred_at: Date;
  customer_id: string;
  service_id: string;
  service_name_en: string;
  service_name_ar: string | null;
  terms_text: string;
  terms_hash: string;
  effective_bps: number;
  requested_by: string;
  requested_by_membership_id: string;
  requester_limit_source: SessionLimit['source'];
  requester_limit_bps: number | null;
  requester_name_ar: string | null;
  requester_name_en: string | null;
  requester_role: string;
  requester_role_is_system: boolean;
  requester_role_name_ar: string | null;
  requester_role_name_en: string;
  requester_first_name_en: string | null;
  requester_first_name_ar: string | null;
  customer_first_name: string;
  requested_at: Date;
  expires_at: Date;
  performers: DiscountProposalPerformer[];
}

/** مدخلات بناء الطلب: البنود المحضّرة وحدّ الطالبة وهويّاتها ولقطاتها. */
export interface DiscountRequestPlanInput {
  lines: readonly PreparedSessionLine[];
  limit: SessionLimit;
  company_id: string;
  business_id: string;
  branch_id: string;
  customer_id: string;
  session_id: string | null;
  occurred_at: Date;
  occurred_business_date: string;
  requested_at: Date;
  requested_by: string;
  requested_by_membership_id: string;
  requester: { role: DiscountRequesterRole; name_en: string | null; name_ar: string | null };
  customer_name: string;
  request_id: string;
  proposal_ids: readonly string[];
  performer_row_ids: readonly string[];
  sha256Hex: (text: string) => string;
}

/** حقائق الشروط المشتركة بين الطلب والاستهلاك: من ومتى وأين، بلا مبالغ السطر. */
export interface DiscountTermsFacts {
  company_id: string;
  business_id: string;
  branch_id: string;
  customer_id: string;
  session_id: string | null;
  requested_by: string;
  requested_by_membership_id: string;
  occurred_business_date: string;
}

/**
 * يبني شروط الخصم لسطر واحد من حقائق الزيارة والطلب ومن البند المحضّر.
 * القاعدة: الطلب والاستهلاك يبنيان الشروط بنفس هذه الدالة، فتساوي البصمة شرط الاستهلاك (D-4).
 *
 * @param facts هوية الطلب والزيارة التي طلبت الموافقة
 * @param line البند المحضّر كما سيُكتب
 * @returns شروط الخصم الموقّعة بصيغتها القانونية
 */
export function discountTermsOfLine(facts: DiscountTermsFacts, line: PreparedSessionLine): DiscountTermsV1 {
  return buildDiscountTerms({
    company_id: facts.company_id,
    business_id: facts.business_id,
    branch_id: facts.branch_id,
    customer_id: facts.customer_id,
    session_id: facts.session_id,
    service_id: line.service.id,
    requested_by: facts.requested_by,
    requested_by_membership_id: facts.requested_by_membership_id,
    occurred_business_date: facts.occurred_business_date,
    list_price: line.service.price,
    price: line.price,
    discount: line.discount,
    performer_ids: line.performers.map((performer) => performer.employee.id),
  });
}

/**
 * يختار دور العضوية التي طلبت، فاللقطة المحفوظة على الطلب تُنسب للعضوية المختارة لا لأي عضوية.
 * القاعدة: طلب بلا عضوية صالحة ممنوع، فالرفض موحّد ولا يكشف العضويات (FR-005).
 *
 * @param memberships عضويات الطالبة وأدوارها وقت الطلب
 * @param membershipId العضوية التي طلبت
 * @returns دور العضوية المطلوبة
 */
export function requesterRole(
  memberships: readonly DiscountRequesterMembership[],
  membershipId: string,
): DiscountRequesterRole {
  const membership = memberships.find((candidate) => candidate.membership_id === membershipId);
  if (membership === undefined) throw new SessionError('FORBIDDEN');
  return membership.role;
}

/**
 * يبني اقتراحاً لكل بند في الطلب، بعد أن يتأكد أن كل بند يحتاج موافقة فعلاً.
 * القاعدة: لا يُحفظ طلب إلا إذا كان كل بند فيه فوق حدّ الطالبة (D-6)؛ والمالك بلا حد فيُرفض طلبه دائماً.
 * الشروط تُبنى من دوال التسجيل نفسها، وبصمتها على النص القانوني للشروط، فالسطر المكتوب يطابق ما وافقت عليه الموافقة.
 * الأسماء تُقطع مرة واحدة هنا (D-18): الاسم الأول للعميل والمنفّذين، ولا يخرج الاسم الكامل ولا الهاتف.
 *
 * @param input البنود المحضّرة وحدّ الطالبة وهويّاتها ولقطاتها ومعرّفات الصفوف
 * @returns اقتراح لكل بند بترتيب البنود، بنفس مواضعها في الطلب
 */
export function planDiscountRequest(input: DiscountRequestPlanInput): DiscountProposalPlan[] {
  refuseLinesWithinLimit(input.lines, input.limit);
  const expiresAt = proposalExpiry(input.requested_at);
  let performerOffset = 0;
  return input.lines.map((line, index) => {
    const proposal = proposalFromLine(input, line, index, expiresAt);
    const performers = performerRows(line, input.performer_row_ids, performerOffset);
    performerOffset += performers.length;
    return { ...proposal, performers };
  });
}

function refuseLinesWithinLimit(lines: readonly PreparedSessionLine[], limit: SessionLimit): void {
  const withinLimit = lines
    .filter((line) => !needsApproval(limit, line.effective_discount_bps))
    .map((line) => line.input_index)
    .sort((left, right) => left - right);
  if (withinLimit.length > 0) {
    throw new DiscountApprovalError('DISCOUNT_APPROVAL_NOT_NEEDED', { input_indexes: withinLimit });
  }
}

function proposalFromLine(
  input: DiscountRequestPlanInput,
  line: PreparedSessionLine,
  index: number,
  expiresAt: Date,
): Omit<DiscountProposalPlan, 'performers'> {
  const proposalId = input.proposal_ids[index];
  if (proposalId === undefined) throw new RangeError('A proposal id is missing');
  const terms = discountTermsOfLine(input, line);
  return {
    id: proposalId,
    request_id: input.request_id,
    input_index: line.input_index,
    session_id: input.session_id,
    occurred_at: input.occurred_at,
    customer_id: input.customer_id,
    service_id: line.service.id,
    service_name_en: line.service.name_en,
    service_name_ar: line.service.name_ar,
    terms_text: canonicalDiscountTerms(terms),
    terms_hash: discountTermsHash(terms, input.sha256Hex),
    effective_bps: terms.effective_bps,
    ...requesterSnapshot(input),
    customer_first_name: firstName(input.customer_name),
    requested_at: input.requested_at,
    expires_at: expiresAt,
  };
}

function requesterSnapshot(input: DiscountRequestPlanInput) {
  return {
    requested_by: input.requested_by,
    requested_by_membership_id: input.requested_by_membership_id,
    requester_limit_source: input.limit.source,
    requester_limit_bps: input.limit.bps,
    requester_name_ar: input.requester.name_ar,
    requester_name_en: input.requester.name_en,
    requester_role: input.requester.role.code,
    requester_role_is_system: input.requester.role.is_system,
    requester_role_name_ar: input.requester.role.name_ar,
    requester_role_name_en: input.requester.role.name_en,
    requester_first_name_en: input.requester.name_en === null ? null : firstName(input.requester.name_en),
    requester_first_name_ar: input.requester.name_ar === null ? null : firstName(input.requester.name_ar),
  };
}

function performerRows(
  line: PreparedSessionLine,
  rowIds: readonly string[],
  offset: number,
): DiscountProposalPerformer[] {
  return line.performers.map((performer, index) => {
    const rowId = rowIds[offset + index];
    if (rowId === undefined) throw new RangeError('A performer row id is missing');
    return {
      id: rowId,
      employee_id: performer.employee.id,
      linked_user_id: performer.employee.user_id,
      first_name_en: firstName(performer.employee.name_en),
      first_name_ar: performer.employee.name_ar === null ? null : firstName(performer.employee.name_ar),
    };
  });
}
