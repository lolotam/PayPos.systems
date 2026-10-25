import { moneyToString } from '@pospay/domain';
import { type ApprovalDecision } from './discount-consumption.ts';
import type { ApprovalRefusal } from './discount-approval-rules.ts';
import { appendOrdinals, authorizedDiscountAmounts, partitionDiscountLines, sessionTotal } from './session-pricing.ts';
import { SessionError } from './session-error.ts';
import type { PreparedSessionLine, SessionLimit, SessionLine, SessionRecord } from './session-types.ts';
type RejectionMessages = { message_ar: string; message_en: string };
type LineIdentity = { id: string; session_id: string; ordinal: number; performer_ids: readonly string[] };
type LineRecorder = { userId: string; membershipId: string; at: Date; late: boolean };
type RejectedLine = {
  input_index: number; service_id: string; name_en: string; name_ar: string | null;
  code: 'SESSION_DISCOUNT_ABOVE_LIMIT'; message_ar: string; message_en: string;
  list_price: string; price: string; discount: string; net: string; effective_discount_bps: number;
  limit_bps: number; limit_source: 'PERSON' | 'BUSINESS' | 'NOT_CONFIGURED';
  minimum_net: string; max_discount_amount: string;
  approval_refusal?: ApprovalRefusal; discount_proposal_id?: string;
};

/**
 * يحدد المقبول قبل أي حفظ ويفحص إجمالي النشط وحده؛ الملغى يحتفظ بترتيبه وسعته.
 * سطر فوق الحدّ مع موافقة مقبولة يصبح مقبولاً يحملها، وسطر فوق الحدّ مع موافقة مرفوضة يرجع بسببها.
 * القاعدة: الموافقة تُغيّر القبول فقط، وبقية بيانات الرفض كما هي (FR-019، FR-021).
 *
 * @param lines كل البنود المتحقق منها
 * @param limit السلطة المالية الموثقة
 * @param existing البنود القديمة؛ الملغاة تستهلك سعة الزيارة
 * @param messages رسالتا الحد من كتالوج الترجمة
 * @param decisions قرارات استهلاك الموافقة لكل سطر يطلب واحدة
 * @returns المقبول وترتيبه والرفض الكامل أو رفض الكل قبل أي كتابة
 */
export function planSessionWrite(lines: readonly PreparedSessionLine[], limit: SessionLimit, existing: readonly SessionLine[], messages: RejectionMessages, decisions: readonly ApprovalDecision[] = []) {
  const aboveLimit = new Set(partitionDiscountLines(lines, limit).rejected.map((line) => line.input_index));
  const byIndex = new Map(decisions.map((decision) => [decision.input_index, decision]));
  const accepted: PreparedSessionLine[] = [], rejected_lines: RejectedLine[] = [];
  for (const line of lines) {
    const decision = byIndex.get(line.input_index);
    if (!aboveLimit.has(line.input_index)) { accepted.push(line); continue; }
    if (decision !== undefined && decision.refusal === null) {
      accepted.push({ ...line, consumed_proposal_id: decision.proposal_id });
      continue;
    }
    rejected_lines.push(rejectedLine(line, limit, messages, decision));
  }
  if (accepted.length === 0) throw new SessionError('SESSION_DISCOUNT_ABOVE_LIMIT', { rejected_lines });
  sessionTotal([...existing.filter((line) => line.status === 'ACTIVE'), ...accepted].map((l) => l.net));
  const ordinals = appendOrdinals(existing.map((line) => line.ordinal), accepted.length);
  return { accepted, rejected_lines, ordinals, outcome: rejected_lines.length === 0 ? 'COMPLETE' as const : 'PARTIAL' as const };
}
/**
 * يبني تفاصيل رفض السطر كما تُعرض للتصحيح، ويضيف سبب رفض الموافقة إن وُجدت.
 *
 * @param line البند المحضّر المرفوض
 * @param limit حدّ المسجّلة
 * @param messages رسالتا الحد من كتالوج الترجمة
 * @param decision قرار استهلاك الموافقة للسطر، إن وُجد
 * @returns تفاصيل الرفض المعروضة
 */
function rejectedLine(line: PreparedSessionLine, limit: SessionLimit, messages: RejectionMessages, decision: ApprovalDecision | undefined): RejectedLine {
  if (limit.source === 'OWNER') throw new SessionError('FORBIDDEN');
  const amounts = authorizedDiscountAmounts(line.service.price, line.price, limit.bps);
  const base: RejectedLine = { input_index: line.input_index, service_id: line.service.id, name_en: line.service.name_en, name_ar: line.service.name_ar,
    code: 'SESSION_DISCOUNT_ABOVE_LIMIT', ...messages, list_price: moneyToString(line.service.price), price: moneyToString(line.price),
    discount: moneyToString(line.discount), net: moneyToString(line.net), effective_discount_bps: line.effective_discount_bps,
    limit_bps: limit.bps, limit_source: limit.source, minimum_net: moneyToString(amounts.minimum_net), max_discount_amount: moneyToString(amounts.max_discount_amount) };
  if (decision === undefined || decision.refusal === null) return base;
  return { ...base, approval_refusal: decision.refusal, discount_proposal_id: decision.proposal_id };
}
/**
 * يثبّت هويات المقبول ووقت كاتبته، دون استعمال input_index كترتيب الزيارة.
 * السطر الذي استهلك موافقة يحملها في `discount_proposal_id`، وحدّه يبقى حدّ المسجّلة نفسها (D-8).
 *
 * @param line البند الصحيح المقبول
 * @param identity هويات مولدة من port وترتيب خصص تحت القفل
 * @param recorder حقائق الكاتب الحالي
 * @param limit الحد الذي طبق عند الحفظ
 * @returns بند جديد بالنسخة الأولى فقط
 */
export function recordedSessionLine(line: PreparedSessionLine, identity: LineIdentity, recorder: LineRecorder, limit: SessionLimit): SessionLine {
  return { ...line, ...identity, recorded_by: recorder.userId, recorded_by_membership_id: recorder.membershipId,
    recorded_at: recorder.at, late: recorder.late, limit, status: 'ACTIVE', revision: 1,
    ...(line.consumed_proposal_id === undefined ? {} : { discount_proposal_id: line.consumed_proposal_id }) };
}
/**
 * غلاف الحدث ينقل بنود هذه الكتابة وحدها؛ لا هاتف ولا مسودات مرفوضة ولا إعادة إصدار للقديم.
 *
 * @param record رأس الزيارة الأصلي
 * @param lines المقبول الجديد فقط
 * @returns حدث بدينار ذي ثلاث خانات ونسخة مخطط واحدة
 */
export function sessionBatchEvent(record: SessionRecord, lines: readonly SessionLine[]) {
  const writer = lines[0];
  if (writer === undefined) throw new SessionError('SESSION_LINE_CAPACITY_EXCEEDED');
  if (lines.some((line) => line.status !== 'ACTIVE' || line.revision !== 1)) throw new RangeError('Recording events require new active revision-one lines');
  return { schema_version: 1 as const, session_id: record.id, business_id: record.business_id, branch_id: record.branch_id,
    customer_id: record.customer.id, occurred_at: record.occurred_at.toISOString(), recorded_at: writer.recorded_at.toISOString(),
    business_date: record.business_date, business_timezone: record.business_timezone, late: writer.late,
    recorded_by: writer.recorded_by, recorded_by_membership_id: writer.recorded_by_membership_id,
    lines: lines.map((line) => ({ line_id: line.id, session_id: record.id, service_id: line.service.id,
      branch_id: record.branch_id, business_id: record.business_id, customer_id: record.customer.id, status: line.status,
      occurred_at: record.occurred_at.toISOString(), recorded_at: line.recorded_at.toISOString(), business_date: record.business_date,
      late: line.late, recorded_by: line.recorded_by, recorded_by_membership_id: line.recorded_by_membership_id,
      list_price: moneyToString(line.service.price), price: moneyToString(line.price), discount: moneyToString(line.discount), net: moneyToString(line.net),
      performers: line.performers.map((p) => ({ employee_id: p.employee.id, share_bps: p.share_bps })),
      rule_snapshot: line.service.rule.kind === 'FIXED' ? { kind: 'FIXED' as const, value: moneyToString(line.service.rule.value) } : { ...line.service.rule },
      counts_snapshot: line.service.counts, package: null, revision: line.revision })) };
}
