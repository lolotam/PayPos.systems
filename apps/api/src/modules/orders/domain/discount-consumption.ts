import {
  consumptionRefusal,
  type ApprovalRefusal,
  type ConsumableProposal,
  type ConsumptionActor,
} from './discount-approval-rules.ts';
import { discountTermsHash, type DiscountTermsV1 } from './discount-terms.ts';
import { partitionDiscountLines } from './session-pricing.ts';
import type { PreparedSessionLine, SessionLimit, SessionLine } from './session-types.ts';

/** الطلب المقفل كما يُقرأ للاستهلاك: صفه مع معرّفه. */
export type LockedProposal = ConsumableProposal & { id: string };

/** سطر يطالب بموافقة: موضعه في الطلب ومعرّف الموافقة والبند المحضّر. */
export interface ApprovalClaim {
  input_index: number;
  proposal_id: string;
  line: PreparedSessionLine;
}

/** قرار الاستهلاك لسطر واحد: سبب الرفض أو القبول، وبصمة شروط السطر. */
export interface ApprovalDecision {
  input_index: number;
  proposal_id: string;
  refusal: ApprovalRefusal | null;
  terms_hash: string;
}

/** أثر استهلاك الموافقة: الطلب والسطر والزيارة، بلا اسم ولا هاتف (FR-022). */
export interface DiscountConsumptionAudit {
  entity: 'discount_proposal';
  entityId: string;
  action: 'discount_proposal.consumed';
  after: { proposal_id: string; line_id: string; session_id: string };
}

/**
 * يجمع السطور التي تطلب موافقة: فوق حدّ المسجّلة ومعها معرّف طلب.
 * القاعدة: السطر داخل الحدّ لا يطالب ولا يُلمس، فيُحفظ على حدّ المسجّلة وتبقى الموافقة بلا استهلاك (D-6).
 * والمالك بلا حدّ فلا يطالب أبداً، ونفس اختبار فصل المقبول عن المرفوض.
 *
 * @param lines البنود المحضّرة بترتيب المدخل
 * @param limit حدّ المسجّلة كما حُلّ من settings
 * @returns المطالبات بترتيب المدخل، وكلها فوق الحدّ ومعها معرّف طلب
 */
export function approvalClaims(lines: readonly PreparedSessionLine[], limit: SessionLimit): ApprovalClaim[] {
  const claims: ApprovalClaim[] = [];
  for (const line of partitionDiscountLines(lines, limit).rejected) {
    const proposal_id = line.approval_proposal_id;
    if (proposal_id === undefined) continue;
    claims.push({ input_index: line.input_index, proposal_id, line });
  }
  return claims;
}

/**
 * يقرر كل مطالبة: هل يستهلك السطر الموافقة أم يرجع وسببه.
 * القاعدة: المطالبات تُفحص بترتيب المدخل، ومعرّف طلب استهلكته مطالبة أسبق من هذا الطلب يجعل المطالبة اللاحقة له مرفوضة (FR-020).
 * والمطالبة المرفوضة لا تُسجّل المعرّف مستهلَكاً، فمطالبة لاحقة بالمعرّف نفسه تُفحص على شروطها هي.
 * والبصمة المُعادة هي بصمة شروط السطر بعد إعادة بنائها، والمقارنة الذرّية تقارنها عند الاستهلاك.
 *
 * @param claims المطالبات بترتيب المدخل
 * @param termsOf بنّاء شروط السطر، نفس دالة الطلب
 * @param proposals الطلبات المقفلة
 * @param actor الفرع والمستخدم والعضوية التي تحاول الاستهلاك
 * @param now اللحظة المحقونة بعد الأقفال
 * @param sha256Hex دالة التجزئة التي تحسب بصمة الشروط
 * @returns قرار لكل مطالبة: سبب الرفض أو القبول، وبصمة شروط السطر
 */
export function decideApprovals(
  claims: readonly ApprovalClaim[],
  termsOf: (line: PreparedSessionLine) => DiscountTermsV1,
  proposals: readonly LockedProposal[],
  actor: ConsumptionActor,
  now: Date,
  sha256Hex: (text: string) => string,
): ApprovalDecision[] {
  const locked = new Map(proposals.map((proposal) => [proposal.id.toLowerCase(), proposal]));
  const consumed = new Set<string>();
  return claims.map((claim) => {
    const key = claim.proposal_id.toLowerCase();
    const terms = termsOf(claim.line);
    const terms_hash = discountTermsHash(terms, sha256Hex);
    if (consumed.has(key)) {
      return { input_index: claim.input_index, proposal_id: claim.proposal_id, refusal: 'CONSUMED', terms_hash };
    }
    const refusal = consumptionRefusal(locked.get(key) ?? null, terms, actor, now, sha256Hex);
    if (refusal === null) consumed.add(key);
    return { input_index: claim.input_index, proposal_id: claim.proposal_id, refusal, terms_hash };
  });
}

/**
 * يبني أثر استهلاك الموافقة لكل سطر استهلك واحدة، بلا اسم ولا هاتف (FR-022).
 * القاعدة: السطر بلا موافقة لا أثر له، فالتدقيق يثبت ما استُهلك فقط.
 *
 * @param lines البنود المحفوظة من هذه الكتابة
 * @param sessionId هوية الزيارة التي تعود إليها السطور
 * @returns أوصاف التدقيق، أثر لكل سطر استهلك موافقة
 */
export function discountConsumptionAudits(lines: readonly SessionLine[], sessionId: string): DiscountConsumptionAudit[] {
  const audits: DiscountConsumptionAudit[] = [];
  for (const line of lines) {
    if (line.discount_proposal_id === undefined) continue;
    audits.push({
      entity: 'discount_proposal',
      entityId: line.discount_proposal_id,
      action: 'discount_proposal.consumed',
      after: { proposal_id: line.discount_proposal_id, line_id: line.id, session_id: sessionId },
    });
  }
  return audits;
}
