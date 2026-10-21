import { discountTermsHash, type DiscountTermsV1 } from './discount-terms.ts';
import type { SessionLimit } from './session-types.ts';

// TODO(spec) DA-Q4b: the expiry rule (how long an approval lives and what it counts from) is being rewritten in spec 057 FR-010; no expiry computation in this slice.

/** حالة الطلب كما تُخزَّن: معلّق، أو موافَق عليه، أو مرفوض، أو مستهلَك. */
export type DiscountProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONSUMED';

/** حالة الطلب كما تُقرأ: الحالة المخزَّنة، أو منتهية لأن وقت الانتهاء مضى. */
export type DiscountProposalState = DiscountProposalStatus | 'EXPIRED';

/** سبب رفض السطر عند استهلاك الموافقة، نفس قيم مخطط `approval_refusal`. */
export type ApprovalRefusal = 'NOT_FOUND' | 'NOT_APPROVED' | 'EXPIRED' | 'CONSUMED' | 'TERMS_MISMATCH';

/** رابط المنفّذة بالمستخدم: لقطة وقت الطلب والربط الحالي، وكلاهما قد يكون فارغاً. */
export interface ProposalPerformerLink {
  snapshot_user_id: string | null;
  current_user_id: string | null;
}

/** الطلب الذي يستهلكه السطر: من طلبه، في أي فرع، ووقت الانتهاء كما كتبه المستدعي. */
export interface ConsumableProposal {
  branch_id: string;
  requested_by: string;
  requested_by_membership_id: string;
  status: DiscountProposalStatus;
  expires_at: Date;
  terms_hash: string;
}

/** من يحاول استهلاك الموافقة: الفرع والمستخدم والعضوية التي طلبت بها. */
export interface ConsumptionActor {
  branch_id: string;
  user_id: string;
  membership_id: string;
}

/**
 * يقرر هل يحتاج هذا الخصم موافقة: كل جزء أكبر من حد مَن يسجّل يستحق موافقة.
 * القاعدة: الحد نفسه داخله، وما فوقه فقط يحتاج موافقة (spec 016: أي جزء فوق الحد).
 * المالك بلا حد، ومَن حدّه غير مضبوط حدّه صفر، فيحتاج أي خصم أكبر من صفر.
 *
 * @param requesterLimit حد مَن يسجّل كما حُلّ من settings
 * @param effectiveBps النسبة الفعلية للخصم بوحدات أساس
 * @returns هل يحتاج السطر موافقة
 */
export function needsApproval(requesterLimit: SessionLimit, effectiveBps: number): boolean {
  if (requesterLimit.source === 'OWNER') return false;
  return effectiveBps > requesterLimit.bps;
}

/**
 * يقرأ حالة الطلب كما تُعرض: طلب أو موافقة انتهى وقتُهما تُقرأ منتهية.
 * القاعدة: `EXPIRED` لا يُكتب في الجدول بل يُشتق من الوقت (D-7)، وحدّه شامل:
 * اللحظة التي يساوي فيها وقت الانتهاء هي آخر لحظة صالحة، فما بعدها منتهية.
 * المرفوض والمستهلَك يبقيان على حالهما لأنهما قراران اتُّخذا.
 * وقت الانتهاء (`expires_at`) مُدخَل يكتبه المستدعي؛ القاعدة التي تحسبه معلّقة: TODO(spec) DA-Q4b.
 *
 * @param status الحالة المخزَّنة للطلب
 * @param expiresAt وقت الانتهاء كما كتبه المستدعي، لا حساب له هنا
 * @param now اللحظة الحالية المحقونة
 * @returns الحالة التي تُقرأ للطلب
 */
export function proposalState(
  status: DiscountProposalStatus,
  expiresAt: Date,
  now: Date,
): DiscountProposalState {
  if (status === 'PENDING' || status === 'APPROVED') {
    return expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : status;
  }
  return status;
}

/**
 * يقرر هل يغطي حدّ المُوافِق هذا الخصم: يغطي ما يساوي حدّه أو أقل منه.
 * القاعدة: الحد شامل هنا (FR-013)، بعكس حاجتها للموافقة في `needsApproval`؛
 * والمالك بلا حد فيغطّي أي خصم، ومَن حدّه غير مضبوط حدّه صفر فلا يغطّي خصماً واحداً.
 *
 * @param approverLimit حد المُوافِق كما حُلّ من settings
 * @param terms شروط الخصم التي وافقت عليها الموافقة
 * @returns هل يغطي حدّ المُوافِق هذا الخصم
 */
export function canApprove(
  approverLimit: SessionLimit,
  terms: Pick<DiscountTermsV1, 'effective_bps'>,
): boolean {
  if (approverLimit.source === 'OWNER') return true;
  return terms.effective_bps <= approverLimit.bps;
}

/**
 * يحدد هل المُوافِق نفّذ السطر بنفسها، بقراءة لقطة وقت الطلب والربط الحالي معاً.
 * القاعدة: اجتماع لا اختلاف — إعادة ربط المنفّذة بين الطلب والموافقة ما تخفيش أنها هي (D-16).
 * النتيجة عَلم يُخزَّن ويُبلَّغ عنه، والموافقة لا تُرفض بسببه (DA-Q3).
 *
 * @param approverUserId مستخدمة المُوافِق
 * @param performers روابط المنفّذات: لقطة وقت الطلب والربط الحالي لكل واحدة
 * @returns هل المُوافِق من منفّذات السطر
 */
export function approverIsPerformer(
  approverUserId: string,
  performers: readonly ProposalPerformerLink[],
): boolean {
  const approver = approverUserId.toLowerCase();
  const matches = (candidate: string | null) =>
    candidate !== null && candidate.toLowerCase() === approver;
  return performers.some(
    (performer) => matches(performer.snapshot_user_id) || matches(performer.current_user_id),
  );
}

/**
 * يقرر هل يستهلك السطر هذا الطلب، ويذكر سبب الرفض إن رفض.
 * القاعدة: أول مطابقة في الترتيب التالي هي النتيجة، وما بعدها لا يُنظر فيه:
 * (أ) طلب غير موجود، أو من فرع آخر، أو من طلبه شخص غير مَن يستهلك — كلها `NOT_FOUND` بلا كاشف وجود (D-5، D-13).
 * (ب) حالة الطلب: معلّق أو مرفوض `NOT_APPROVED`، منتهي `EXPIRED`، مستهلَك `CONSUMED` (D-7).
 * (ج) موافَق عليه وبصمة الشروط مختلفة `TERMS_MISMATCH` — تطابق بالظبط بلا تسامح (D-4).
 * (د) غير ذلك `null`: السطر يستهلك الموافقة.
 * مقارنة المعرّفات لا تفرّق بين الأحرف الكبيرة والصغيرة، وبصمة الشروط تُقارن صغيرة.
 * وقت الانتهاء (`expires_at`) مُدخَل يكتبه المستدعي؛ القاعدة التي تحسبه معلّقة: TODO(spec) DA-Q4b.
 *
 * @param proposal الطلب الذي يستهلكه السطر، أو `null` إن لم يوجد
 * @param lineTerms شروط السطر كما حُسبت عند الكتابة
 * @param actor الفرع والمستخدم والعضوية التي تحاول الاستهلاك
 * @param now اللحظة الحالية المحقونة
 * @param sha256Hex دالة التجزئة التي تحسب بصمة الشروط
 * @returns سبب الرفض، أو `null` إن جاز استهلاك الطلب
 */
export function consumptionRefusal(
  proposal: ConsumableProposal | null,
  lineTerms: DiscountTermsV1,
  actor: ConsumptionActor,
  now: Date,
  sha256Hex: (text: string) => string,
): ApprovalRefusal | null {
  if (proposal === null) return 'NOT_FOUND';
  if (!sameId(proposal.branch_id, actor.branch_id)) return 'NOT_FOUND';
  if (!sameId(proposal.requested_by, actor.user_id)) return 'NOT_FOUND';
  if (!sameId(proposal.requested_by_membership_id, actor.membership_id)) return 'NOT_FOUND';
  const state = proposalState(proposal.status, proposal.expires_at, now);
  if (state === 'PENDING' || state === 'REJECTED') return 'NOT_APPROVED';
  if (state === 'EXPIRED') return 'EXPIRED';
  if (state === 'CONSUMED') return 'CONSUMED';
  const hash = discountTermsHash(lineTerms, sha256Hex).toLowerCase();
  return hash === proposal.terms_hash.toLowerCase() ? null : 'TERMS_MISMATCH';
}

/**
 * يقارن معرّفين متساويين مهما اختلفت حالة أحرفهما، لأن المعرّف الواحد قد يُكتب بأحرف كبيرة أو صغيرة.
 *
 * @param left المعرّف الأول
 * @param right المعرّف الثاني
 * @returns هل المعرّفان واحد
 */
function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
