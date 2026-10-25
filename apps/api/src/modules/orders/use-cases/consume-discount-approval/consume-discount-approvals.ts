import { approvalClaims, decideApprovals, type ApprovalDecision } from '../../domain/discount-consumption.ts';
import type { ConsumptionActor } from '../../domain/discount-approval-rules.ts';
import { discountTermsOfLine, type DiscountTermsFacts } from '../../domain/discount-request.ts';
import type { PreparedSessionLine, SessionLimit, SessionLine } from '../../domain/session-types.ts';
import type { LockedDiscountProposal } from '../../ports/discount-consumption.port.ts';
import type { SessionTransaction } from '../../ports/service-session-transactions.port.ts';

/** سطر مدخل كما جاء من العميل: معرّف الموافقة اختياري. */
type InputLine = { discount_proposal_id?: string };

/** حقائق الاستهلاك التي يحتاجها قرار كل سطر. */
export interface ApprovalDecisionFacts {
  prepared: readonly PreparedSessionLine[];
  limit: SessionLimit;
  terms: DiscountTermsFacts;
  actor: ConsumptionActor;
}

/**
 * يقفل طلبات الموافقة التي سمّت بها بنود الطلب، قبل أي لحظة تُقرأ فيها حدود أو نوافذ.
 * القاعدة: الطلب بلا معرّف موافقة لا يلمس جدول الطلبات ولا يكلّف شيئاً (FR-019).
 * والأقفال بترتيب تصاعدي للمعرّفات، فالمتنافسون على نفس الطلب يتسلسلون بلا موت (FR-011).
 *
 * @param tx معاملة السطر نفسها
 * @param inputLines بنود الطلب كما أرسلها العميل
 * @returns الطلبات المقفلة namesake، وفارغة إن لم يسمّ الطلب أي طلب
 */
export async function lockApprovalProposals(
  tx: SessionTransaction,
  inputLines: readonly InputLine[],
): Promise<LockedDiscountProposal[]> {
  const ids = [...new Set(inputLines.map((line) => line.discount_proposal_id).filter((id): id is string => id !== undefined))];
  if (ids.length === 0) return [];
  return tx.consumption.lock(ids);
}

/**
 * يقرر كل سطر يطلب موافقة: هل يستهلكها أم يرجع وسببه.
 * القاعدة: الشروط تُبنى بنفس دالة الطلب، فتساوي البصمة هو شرط الاستهلاك (D-4).
 *
 * @param tx معاملة السطر نفسها
 * @param facts البنود المحضّرة وحدّ المسجّلة وشروط الطلب ومن يستهلك
 * @param locked الطلبات المقفلة namesake
 * @param at اللحظة المحقونة بعد الأقفال
 * @returns قرار لكل سطر يطلب موافقة، وفارغة إن لم يطلب أي سطر واحدة
 */
export function approvalDecisions(
  tx: SessionTransaction,
  facts: ApprovalDecisionFacts,
  locked: readonly LockedDiscountProposal[],
  at: Date,
): ApprovalDecision[] {
  const claims = approvalClaims(facts.prepared, facts.limit);
  if (claims.length === 0) return [];
  const sha256Hex = (text: string) => tx.consumption.hash.sha256Hex(text);
  return decideApprovals(claims, (line) => discountTermsOfLine(facts.terms, line), locked, facts.actor, at, sha256Hex);
}

/**
 * ينقل كل موافقة استهلكها سطر من الموافَق عليها إلى المستهلَكة، داخل معاملة السطر.
 * القاعدة: المقارنة الذرّية تفشل فقط لو غيّر أحد الطلب بين القفل والكتابة، وهذا عطل لا رفض (FR-019).
 *
 * @param tx معاملة السطر نفسها
 * @param lines البنود المحفوظة من هذه الكتابة
 * @param decisions قرارات الاستهلاك لكل سطر
 * @param at لحظة الاستهلاك بعد الأقفال
 * @returns يكتمل نقل كل موافقة أو يرتفع العطل فيتراجع كل شيء
 */
export async function commitDiscountApprovals(
  tx: SessionTransaction,
  lines: readonly SessionLine[],
  decisions: readonly ApprovalDecision[],
  at: Date,
): Promise<void> {
  for (const line of lines) {
    if (line.discount_proposal_id === undefined) continue;
    const decision = decisions.find((entry) =>
      entry.proposal_id === line.discount_proposal_id && entry.input_index === line.input_index);
    if (decision === undefined) throw new Error('A consumed discount proposal has no decision');
    const consumed = await tx.consumption.consume(line.discount_proposal_id, line.id, decision.terms_hash, at);
    if (!consumed) throw new Error('A locked discount proposal lost its compare-and-set');
  }
}
