import type {
  DiscountDecisionPlan,
  LockedDiscountProposal,
} from './discount-decision-plan.ts';

/** قناة القرار المثبتة في التدقيق والحدث؛ القرار البعيد لا يحمل جهازاً. */
export interface DiscountDecisionChannel {
  decided_via: 'PIN' | 'REMOTE';
  decided_device_id: string | null;
}

/** هويّات النطاق ولقبا المُوافِق المحسوبان خارج النطاق النقي. */
export interface DiscountDecisionEventContext extends DiscountDecisionChannel {
  business_id: string;
  branch_id: string;
  decider_label_ar: string;
  decider_label_en: string;
}

/**
 * يبني أثر تدقيق لكل قرار، دون سبب الرفض أو اسم عميل أو هاتف أو رقم سرّي.
 * القاعدة: الموافقة تثبت القناة والعضوية والحد وعلم المنفّذ؛ الرفض يثبت القرار وقناته فقط (FR-022).
 *
 * @param plan خطة القرار المكتملة
 * @param context قناة القرار وجهازها، وهو `null` للقرار البعيد
 * @returns أوصاف تدقيق بترتيب اقتراحات الخطة
 */
export function discountDecisionAudits(
  plan: DiscountDecisionPlan,
  context: DiscountDecisionChannel,
) {
  return plan.proposals.map((proposal) => ({
    entity: 'discount_proposal' as const,
    entityId: proposal.id,
    action: plan.decision === 'APPROVE'
      ? ('discount_proposal.approved' as const)
      : ('discount_proposal.rejected' as const),
    after: {
      status: proposal.status,
      decided_by: plan.decided_by,
      decided_by_membership_id: plan.decided_by_membership_id,
      decided_via: context.decided_via,
      decided_device_id: context.decided_device_id,
      decided_at: plan.decided_at.toISOString(),
      ...(plan.decision === 'APPROVE'
        ? {
            approved_limit_source: proposal.approved_limit_source,
            approved_limit_bps: proposal.approved_limit_bps,
            approver_is_performer: proposal.approver_is_performer,
          }
        : {}),
    },
  }));
}

/**
 * يبني حدث الموافقة على شغل المُوافِق من الاقتراحات المعلّمة فقط، أو `null` إن لم توجد واحدة.
 * القاعدة: حدث واحد للمعاملة، ولا يحمل إلا الخدمة والنسبة ولقب المُوافِق؛ لا عميل ولا سبب رفض ولا بيانات اتصال.
 *
 * @param plan خطة الموافقة التي قد تحمل علم المنفّذ
 * @param locked الاقتراحات المقفلة التي تمدّ أسماء الخدمات المخزنة
 * @param context النطاق والقناة ولقبا المُوافِق المحسوبان بـ `editorLabel`
 * @returns حمولة `DiscountApprovedByPerformer` أو `null` عند غياب العلم
 */
export function discountApprovedByPerformerEvent(
  plan: DiscountDecisionPlan,
  locked: readonly LockedDiscountProposal[],
  context: DiscountDecisionEventContext,
) {
  if (plan.decision !== 'APPROVE' || !plan.has_performer_flag) return null;
  const flaggedIds = new Set(
    plan.proposals.filter((proposal) => proposal.approver_is_performer === true).map((proposal) => proposal.id),
  );
  return {
    schema_version: 1 as const,
    business_id: context.business_id,
    branch_id: context.branch_id,
    decided_by: plan.decided_by,
    decider_label_en: context.decider_label_en,
    decider_label_ar: context.decider_label_ar,
    decided_via: context.decided_via,
    proposals: locked.filter((proposal) => flaggedIds.has(proposal.id)).map((proposal) => ({
      id: proposal.id,
      service_id: proposal.service_id,
      name_en: proposal.service_name_en,
      name_ar: proposal.service_name_ar,
      effective_bps: proposal.effective_bps,
    })),
  };
}

/**
 * يبني رد القرار بنفس ترتيب `proposal_ids` الأصلي، مع وقت الانتهاء الذي كتبه الطلب دون تغيير.
 * القاعدة: الرد يحمل المعرّف والحالة ووقت الانتهاء فقط، ولا يكشف المُوافِق أو السبب (FR-018).
 *
 * @param plan خطة القرار المرتبة كطلب العميل
 * @returns جسم الرد المتوافق مع عقد القرار
 */
export function discountDecisionResponse(plan: DiscountDecisionPlan) {
  return {
    proposals: plan.proposals.map((proposal) => ({
      id: proposal.id,
      status: proposal.status,
      expires_at: proposal.expires_at.toISOString(),
    })),
  };
}
