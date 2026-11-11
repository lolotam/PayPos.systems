import {
  approverIsPerformer,
  canApprove,
  proposalState,
  type DiscountProposalStatus,
  type ProposalPerformerLink,
} from './discount-approval-rules.ts';
import { DiscountDecisionError } from './discount-decision-error.ts';
import type { SessionLimit } from './session-types.ts';

const REJECT_REASON_MAX_LENGTH = 500;
const EDGE_WHITESPACE = ' \t\r\n';

/** منفّذ كما حُفظت صلته بالمستخدم وقت طلب الموافقة. */
export interface LockedDiscountPerformer {
  employee_id: string;
  snapshot_user_id: string | null;
}

/** اقتراح مقفول بكل الحقائق التي يحتاجها القرار والتدقيق والحدث. */
export interface LockedDiscountProposal {
  id: string;
  status: DiscountProposalStatus;
  expires_at: Date;
  terms_hash: string;
  effective_bps: number;
  requested_by: string;
  service_id: string;
  service_name_en: string;
  service_name_ar: string | null;
  occurred_at: Date;
  performers: readonly LockedDiscountPerformer[];
}

/** اقتراح بعد دمج لقطة منفّذيه بروابطهم الحالية، دون أي قراءة خارجية. */
export interface DiscountDecisionProposal
  extends Omit<LockedDiscountProposal, 'terms_hash' | 'performers'> {
  performers: readonly ProposalPerformerLink[];
}

/** لقطة من يقرر: اسما الموظف إن وُجدا ولقطة دور العضوية دائماً. */
export interface DiscountDeciderSnapshot {
  decider_name_ar: string | null;
  decider_name_en: string | null;
  decider_role: string;
  decider_role_is_system: boolean;
  decider_role_name_ar: string | null;
  decider_role_name_en: string;
}

/** ما يُكتب على اقتراح واحد عند الموافقة أو الرفض. */
export interface DiscountProposalDecision {
  id: string;
  status: 'APPROVED' | 'REJECTED';
  expires_at: Date;
  approver_is_performer: boolean | null;
  approved_limit_source: SessionLimit['source'] | null;
  approved_limit_bps: number | null;
  reject_reason: string | null;
}

/** خطة مكتملة للدفعة، بلا أثر جزئي عند رفض أي اقتراح. */
export interface DiscountDecisionPlan {
  decision: 'APPROVE' | 'REJECT';
  decided_by: string;
  decided_by_membership_id: string;
  decided_at: Date;
  has_performer_flag: boolean;
  proposals: readonly DiscountProposalDecision[];
}

interface DecisionBase {
  proposals: readonly DiscountDecisionProposal[];
  user_id: string;
  membership_id: string;
  now: Date;
}

/** مدخلات القرار: الموافقة تحتاج حد العضوية، والرفض لا يحتاج حداً ولا فحص منفّذ. */
export type DiscountDecisionInput = DecisionBase &
  (
    | { decision: 'APPROVE'; limit: SessionLimit }
    | { decision: 'REJECT'; reason?: string | undefined }
  );

/**
 * يفحص حالة كل اقتراح وبصمته عند اللحظة المحقونة قبل اختيار العضوية أو قواعد الموافقة.
 * القاعدة: المنتهي أو المقرر يرفض الدفعة بـ 409، والبصمة المختلفة ترفضها بـ 409، في الموافقة والرفض معاً.
 *
 * @param locked الاقتراحات المقفلة بترتيب معرّفات الطلب الأصلي
 * @param termsHashes البصمات المرسلة بنفس ترتيب الاقتراحات
 * @param now اللحظة الوحيدة المقروءة بعد كل الأقفال
 * @returns لا شيء عند سلامة الدفعة؛ أول فشل يرمي رفضاً بمعرّف اقتراحه
 */
export function planDiscountStatus(
  locked: readonly LockedDiscountProposal[],
  termsHashes: readonly string[],
  now: Date,
): void {
  locked.forEach((proposal, index) => {
    if (proposalState(proposal.status, proposal.expires_at, now) !== 'PENDING') {
      throw new DiscountDecisionError('DISCOUNT_PROPOSAL_NOT_PENDING', { proposal_id: proposal.id });
    }
    const expected = termsHashes[index];
    if (expected === undefined || !equalsIgnoringCase(proposal.terms_hash, expected)) {
      throw new DiscountDecisionError('DISCOUNT_PROPOSAL_CHANGED', { proposal_id: proposal.id });
    }
  });
}

/**
 * يبني قرار الدفعة بعد نجاح فحص الحالة والبصمة واختيار العضوية.
 * القاعدة: الموافقة تفحص الحد ثم منع موافقة الطالبة وتحسب علم المنفّذ؛ الرفض يتجاوز الثلاثة ويترك العلم `null`.
 * سبب الرفض اختياري، لكنه إن وُجد يُقصّ ويجب أن يبقى بين حرف و500 حرف كما تقيسها القاعدة.
 *
 * @param input الاقتراحات ولحظة القرار ونوع القرار وحدّ الموافقة عند الموافقة أو السبب عند الرفض
 * @returns خطة واحدة لكل الدفعة بترتيب الاقتراحات المدخلة
 */
export function planDiscountDecision(input: DiscountDecisionInput): DiscountDecisionPlan {
  const reason = input.decision === 'REJECT' ? normalizeRejectReason(input.reason) : null;
  const proposals = input.proposals.map((proposal) => decideProposal(proposal, input, reason));
  return {
    decision: input.decision,
    decided_by: input.user_id,
    decided_by_membership_id: input.membership_id,
    decided_at: input.now,
    has_performer_flag: proposals.some((proposal) => proposal.approver_is_performer === true),
    proposals,
  };
}

function decideProposal(
  proposal: DiscountDecisionProposal,
  input: DiscountDecisionInput,
  reason: string | null,
): DiscountProposalDecision {
  if (input.decision === 'APPROVE') {
    if (!canApprove(input.limit, proposal)) {
      throw new DiscountDecisionError('DISCOUNT_APPROVER_LIMIT_TOO_LOW', {
        proposal_id: proposal.id,
        limit_bps: input.limit.bps,
        effective_bps: proposal.effective_bps,
      });
    }
    if (equalsIgnoringCase(proposal.requested_by, input.user_id)) {
      throw new DiscountDecisionError('DISCOUNT_APPROVER_IS_REQUESTER', { proposal_id: proposal.id });
    }
  }
  const approving = input.decision === 'APPROVE';
  return {
    id: proposal.id,
    status: approving ? 'APPROVED' : 'REJECTED',
    expires_at: proposal.expires_at,
    approver_is_performer: approving
      ? approverIsPerformer(input.user_id, proposal.performers)
      : null,
    approved_limit_source: approving ? input.limit.source : null,
    approved_limit_bps: approving ? input.limit.bps : null,
    reject_reason: approving ? null : reason,
  };
}

function normalizeRejectReason(reason: string | undefined): string | null {
  if (reason === undefined) return null;
  let start = 0;
  let end = reason.length;
  while (start < end && EDGE_WHITESPACE.includes(reason.charAt(start))) start += 1;
  while (end > start && EDGE_WHITESPACE.includes(reason.charAt(end - 1))) end -= 1;
  const trimmed = reason.slice(start, end);
  const length = Array.from(trimmed).length;
  if (length < 1 || length > REJECT_REASON_MAX_LENGTH) {
    throw new DiscountDecisionError('DISCOUNT_REJECT_REASON_INVALID');
  }
  return trimmed;
}

function equalsIgnoringCase(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
