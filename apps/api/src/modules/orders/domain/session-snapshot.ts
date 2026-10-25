import { moneyToString } from '@pospay/domain';
import { sessionTotal } from './session-pricing.ts';
import type { SessionLine, SessionRecord, SessionRule } from './session-types.ts';

/**
 * المال في القاعدة الثابتة يعبر JSON بالدينار بثلاث خانات، مثل سعر البند.
 *
 * @param rule قاعدة العمولة بالفلس داخلياً
 * @returns القاعدة بصيغة النقل بدون bigint
 */
export function sessionRuleSnapshot(rule: SessionRule) {
  return rule.kind === 'FIXED' ? { kind: rule.kind, value: moneyToString(rule.value) } : { ...rule };
}
/**
 * يحفظ لقطة عرض البند من حقائق الكتابة دون أي join بين السياقات.
 * ومعرّف الموافقة المستهلكة يظهر فقط إن كان للسطر واحدة، فالسطر القديم يبقى بايتاً ببايت.
 *
 * @param line البند المحفوظ
 * @returns بيانات العرض بكل مبالغها بالدينار
 */
export function sessionLineSnapshot(line: SessionLine) {
  return {
    id: line.id, session_id: line.session_id, service_id: line.service.id, input_index: line.input_index, ordinal: line.ordinal,
    name_en: line.service.name_en, name_ar: line.service.name_ar, list_price: moneyToString(line.service.price), price: moneyToString(line.price),
    discount: moneyToString(line.discount), net: moneyToString(line.net), effective_discount_bps: line.effective_discount_bps,
    limit_bps_applied: line.limit.bps, limit_source: line.limit.source, status: line.status, revision: line.revision,
    rule_snapshot: sessionRuleSnapshot(line.service.rule), counts_snapshot: line.service.counts, catalog_revision: line.service.revision,
    has_performer_warning: line.has_performer_warning,
    performers: line.performers.map((p, i) => ({ id: line.performer_ids[i] as string, employee_id: p.employee.id, performer_ordinal: i + 1,
      name_en: p.employee.name_en, name_ar: p.employee.name_ar, share_bps: p.share_bps,
      not_clocked_in_warning: p.not_clocked_in_warning, approved_leave_warning: p.approved_leave_warning })),
    recorded_by: line.recorded_by, recorded_by_membership_id: line.recorded_by_membership_id, recorded_at: line.recorded_at.toISOString(), late: line.late,
    ...(line.discount_proposal_id === undefined ? {} : { discount_proposal_id: line.discount_proposal_id }),
  };
}
/**
 * يعيد كل البنود للتاريخ وإجمالي النشط فقط؛ يحافظ على وقت وهويّة رأس الزيارة الأصليين.
 *
 * @param record الزيارة وكل بنودها المحفوظة
 * @returns لقطة الاستجابة الآمنة
 */
export function sessionSnapshot(record: SessionRecord) {
  return { id: record.id, business_id: record.business_id, branch_id: record.branch_id, customer: { ...record.customer },
    recorded_by: record.recorded_by, recorded_by_membership_id: record.recorded_by_membership_id,
    occurred_at: record.occurred_at.toISOString(), recorded_at: record.recorded_at.toISOString(), business_date: record.business_date,
    business_timezone: record.business_timezone, late: record.late,
    total_net: moneyToString(sessionTotal(record.lines.filter((line) => line.status === 'ACTIVE').map((l) => l.net))), lines: record.lines.map(sessionLineSnapshot) };
}
