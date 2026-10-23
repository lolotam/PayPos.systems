import type { DiscountProposalPlan } from './discount-request.ts';

/** سياق الطلب في الحدث: هويّات الطلب والنشاط والفرع والطالبة ولحظة الزيارة. */
export interface DiscountRequestEventContext {
  request_id: string;
  business_id: string;
  branch_id: string;
  requested_by: string;
  occurred_at: Date;
}

/** اسم خدمة في الحدث: لقطة وقت الطلب، فلا يقرأ الجرس الكتالوج (FR-024). */
interface EventService {
  service_id: string;
  name_en: string;
  name_ar: string | null;
}

/**
 * يبني حدث طلب الموافقة: عدد السطور وأعلى نسبة وأسماء الخدمات المميّزة.
 * القاعدة: خدمات مميّزة بـ service_id وبترتيب أول ظهور، والحدث يحمل اسم الخدمة لا الكتالوج (FR-024).
 * لا اسم عميل ولا هاتف ولا شروط الخصم: الجرس يعرض الفرع والخدمة وأعلى نسبة وعدد السطور فقط.
 *
 * @param proposals اقتراحات الطلب كما حُفظت
 * @param context هويّات الطلب والنشاط والفرع والطالبة ولحظة الزيارة
 * @returns حمولة حدث DiscountApprovalRequested
 */
export function discountRequestEvent(
  proposals: readonly DiscountProposalPlan[],
  context: DiscountRequestEventContext,
) {
  const services: EventService[] = [];
  const seen = new Set<string>();
  for (const proposal of proposals) {
    if (seen.has(proposal.service_id)) continue;
    seen.add(proposal.service_id);
    services.push({
      service_id: proposal.service_id,
      name_en: proposal.service_name_en,
      name_ar: proposal.service_name_ar,
    });
  }
  return {
    schema_version: 1 as const,
    request_id: context.request_id,
    business_id: context.business_id,
    branch_id: context.branch_id,
    requested_by: context.requested_by,
    line_count: proposals.length,
    max_effective_bps: proposals.reduce((max, proposal) => Math.max(max, proposal.effective_bps), 0),
    services,
    occurred_at: context.occurred_at.toISOString(),
  };
}

/**
 * يبني أثر تدقيق لكل اقتراح: من طلب ماذا وبأي حد وبأي بصمة، بلا أسماء ولا عميلة ولا هاتف (FR-022).
 * القاعدة: الأثر يثبت ما رُفض لاحقاً؛ الاسم الكامل للعميلة لا يدخل أي سجل.
 *
 * @param proposals اقتراحات الطلب كما حُفظت
 * @returns أوصاف التدقيق، أثر لكل اقتراح
 */
export function discountRequestAudits(proposals: readonly DiscountProposalPlan[]) {
  return proposals.map((proposal) => ({
    entity: 'discount_proposal' as const,
    entityId: proposal.id,
    action: 'discount_proposal.requested' as const,
    after: {
      request_id: proposal.request_id,
      input_index: proposal.input_index,
      kind: 'RECORD' as const,
      session_id: proposal.session_id,
      service_id: proposal.service_id,
      effective_bps: proposal.effective_bps,
      terms_hash: proposal.terms_hash,
      requested_by: proposal.requested_by,
      requested_by_membership_id: proposal.requested_by_membership_id,
      requester_limit_source: proposal.requester_limit_source,
      requester_limit_bps: proposal.requester_limit_bps,
      expires_at: proposal.expires_at.toISOString(),
    },
  }));
}

/**
 * يبني رد الطلب: المعرّفات والحالة والوقت المنتهي والبصمة لكل سطر، بترتيب الطلب.
 * القاعدة: الرد لا يحمل بيانات الموافِق ولا اسم العميلة؛ الحالة المعلّقة وحدها الآن (FR-007).
 *
 * @param requestId معرّف الطلب الذي شاركت فيه كل السطور
 * @param occurredAt لحظة الزيارة المطبّعة التي بُنيت منها الشروط
 * @param proposals اقتراحات الطلب كما حُفظت
 * @returns جسم رد الطلب 201
 */
export function discountRequestResponse(
  requestId: string,
  occurredAt: Date,
  proposals: readonly DiscountProposalPlan[],
) {
  return {
    request_id: requestId,
    occurred_at: occurredAt.toISOString(),
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      input_index: proposal.input_index,
      status: 'PENDING' as const,
      expires_at: proposal.expires_at.toISOString(),
      effective_bps: proposal.effective_bps,
      terms_hash: proposal.terms_hash,
    })),
  };
}
