import { moneyToString } from '@pospay/domain';
import type { SessionLine, SessionRecord } from './session-types.ts';

/**
 * يسجل أثر المقبول فقط؛ تجاوز السعر والخصم الموجب كلاهما تغيير مالي مدقق.
 *
 * @param record زيارة محفوظة أو موسعة
 * @param added بنود الكتابة الحالية
 * @param outcome نتيجة القبول دون كشف المرفوضات
 * @param append هل الأثر إضافة لنفس الزيارة
 * @returns أوصاف التدقيق الآمنة بدون هاتف أو بيانات سائق قاعدة البيانات
 */
export function sessionAuditEntries(record: SessionRecord, added: readonly SessionLine[], outcome: 'COMPLETE' | 'PARTIAL', append: boolean) {
  const writer = added[0];
  if (writer === undefined) throw new RangeError('Audit requires accepted lines');
  const header = { entity: 'service_session', entityId: record.id, action: append ? 'session.lines_added' : 'session.created',
    after: { session_id: record.id, recorded_by: writer.recorded_by, recorded_by_membership_id: writer.recorded_by_membership_id,
      recorded_at: writer.recorded_at.toISOString(), added_line_ids: added.map((l) => l.id), added_count: added.length, outcome, late: writer.late,
      initial_unequal_shares: added.filter((l) => l.explicit_unequal_shares).map((l) => ({ line_id: l.id,
        performers: l.performers.map((p) => ({ employee_id: p.employee.id, share_bps: p.share_bps })) })) } };
  const prices = added.filter((l) => l.price !== l.service.price || l.discount > 0n).map((l) => ({
    entity: 'service_line', entityId: l.id, action: 'session.price_discount_recorded',
    after: { session_id: record.id, line_id: l.id, recorded_by: l.recorded_by, recorded_by_membership_id: l.recorded_by_membership_id,
      recorded_at: l.recorded_at.toISOString(), list_price: moneyToString(l.service.price), price: moneyToString(l.price), discount: moneyToString(l.discount),
      net: moneyToString(l.net), effective_discount_bps: l.effective_discount_bps, limit_bps_applied: l.limit.bps, limit_source: l.limit.source } }));
  return [header, ...prices];
}
