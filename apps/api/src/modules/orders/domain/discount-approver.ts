import { DiscountDecisionError } from './discount-decision-error.ts';
import { SessionError } from './session-error.ts';

/** لقطة دور العضوية المختارة، وتُحفظ مع القرار حتى لا يتغير معناها لاحقاً. */
export interface DiscountApproverRole {
  code: string;
  is_system: boolean;
  name_ar: string | null;
  name_en: string;
}

/** عضوية تغطي الفرع وتمنح الموافقة بذاتها، لا مجرد عضوية بحد أعلى. */
export interface DiscountApproverMembership {
  membership_id: string;
  /** نطاق العضوية: شركة أو نشاط أو فرع. */
  scope_type: 'COMPANY' | 'BUSINESS' | 'BRANCH';
  /** معرّف ذلك النطاق. */
  scope_id: string;
  role: DiscountApproverRole;
}

/** حقائق السلطة بعد حماية المالك وتقييم المنع على كل العضويات السارية. */
export interface DiscountApproverAccess {
  denied: boolean;
  feature: boolean;
  eligible: readonly DiscountApproverMembership[];
}

/**
 * يختار عضوية الموافقة التي يُقاس بحدّها ويُنسب إليها القرار.
 * القاعدة: العضوية نفسها يجب أن تغطي الفرع وتمنح `approve:discounts:branch`؛ عند التعدد يلزم اختيار صريح ولا يُختار أعلى حد.
 *
 * @param access المنع والميزة والعضويات المؤهلة عند اللحظة المحقونة
 * @param selection العضوية التي حددها المستخدم، أو غياب الاختيار
 * @returns العضوية المختارة مع لقطة دورها
 */
export function resolveDiscountApprover(
  access: DiscountApproverAccess,
  selection: string | undefined,
): DiscountApproverMembership {
  if (access.denied || access.eligible.length === 0) throw new SessionError('FORBIDDEN');
  if (!access.feature) throw new SessionError('FEATURE_DISABLED');
  if (selection !== undefined) {
    const selected = access.eligible.find((membership) => membership.membership_id === selection);
    if (selected === undefined) throw new SessionError('FORBIDDEN');
    return selected;
  }
  if (access.eligible.length !== 1) {
    throw new DiscountDecisionError('DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED', {
      approver_membership_ids: access.eligible.map((membership) => membership.membership_id),
      approver_memberships: access.eligible.map((membership) => ({
        membership_id: membership.membership_id,
        scope_type: membership.scope_type,
        scope_id: membership.scope_id,
        role: membership.role,
      })),
    });
  }
  return access.eligible[0] as DiscountApproverMembership;
}
