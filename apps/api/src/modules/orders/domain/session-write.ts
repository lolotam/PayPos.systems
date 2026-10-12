import { moneyToString } from '@pospay/domain';
import { authorizedDiscountAmounts, appendOrdinals, partitionDiscountLines, sessionTotal } from './session-pricing.ts';
import { SessionError } from './session-error.ts';
import type { PreparedSessionLine, SessionLimit, SessionLine, SessionRecord } from './session-types.ts';
type RejectionMessages = { message_ar: string; message_en: string };
type LineIdentity = { id: string; session_id: string; ordinal: number; performer_ids: readonly string[] };
type LineRecorder = { userId: string; membershipId: string; at: Date; late: boolean };

/**
 * يحدد المقبول قبل أي حفظ ويفحص إجمالي النشط وحده؛ الملغى يحتفظ بترتيبه وسعته.
 *
 * @param lines كل البنود المتحقق منها
 * @param limit السلطة المالية الموثقة
 * @param existing البنود القديمة؛ الملغاة تستهلك سعة الزيارة
 * @param messages رسالتا الحد من كتالوج الترجمة
 * @returns المقبول وترتيبه والرفض الكامل أو رفض الكل قبل أي كتابة
 */
export function planSessionWrite(lines: readonly PreparedSessionLine[], limit: SessionLimit, existing: readonly SessionLine[], messages: RejectionMessages) {
  const { accepted, rejected } = partitionDiscountLines(lines, limit);
  const rejected_lines = rejected.map((l) => {
    if (limit.source === 'OWNER') throw new SessionError('FORBIDDEN');
    const amounts = authorizedDiscountAmounts(l.service.price, l.price, limit.bps);
    return { input_index: l.input_index, service_id: l.service.id, name_en: l.service.name_en, name_ar: l.service.name_ar,
      code: 'SESSION_DISCOUNT_ABOVE_LIMIT' as const, ...messages, list_price: moneyToString(l.service.price), price: moneyToString(l.price),
      discount: moneyToString(l.discount), net: moneyToString(l.net), effective_discount_bps: l.effective_discount_bps,
      limit_bps: limit.bps, limit_source: limit.source, minimum_net: moneyToString(amounts.minimum_net), max_discount_amount: moneyToString(amounts.max_discount_amount) };
  });
  if (accepted.length === 0) throw new SessionError('SESSION_DISCOUNT_ABOVE_LIMIT', { rejected_lines });
  sessionTotal([...existing.filter((line) => line.status === 'ACTIVE'), ...accepted].map((l) => l.net));
  const ordinals = appendOrdinals(existing.map((line) => line.ordinal), accepted.length);
  return { accepted, rejected_lines, ordinals, outcome: rejected.length === 0 ? 'COMPLETE' as const : 'PARTIAL' as const };
}
/**
 * يثبّت هويات المقبول ووقت كاتبته، دون استعمال input_index كترتيب الزيارة.
 *
 * @param line البند الصحيح المقبول
 * @param identity هويات مولدة من port وترتيب خصص تحت القفل
 * @param recorder حقائق الكاتب الحالي
 * @param limit الحد الذي طبق عند الحفظ
 * @returns بند جديد بالنسخة الأولى فقط
 */
export function recordedSessionLine(line: PreparedSessionLine, identity: LineIdentity, recorder: LineRecorder, limit: SessionLimit): SessionLine {
  return { ...line, ...identity, recorded_by: recorder.userId, recorded_by_membership_id: recorder.membershipId,
    recorded_at: recorder.at, late: recorder.late, limit, status: 'ACTIVE', revision: 1 };
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
