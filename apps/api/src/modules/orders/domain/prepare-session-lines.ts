import { SessionError } from './session-error.ts';
import { discountFromPercent, effectiveDiscountBps, lineNet } from './session-pricing.ts';
import { equalShares, performerWarnings, validateRecorderPerformers, validateShares } from './session-performers.ts';
import type { PreparedSessionLine, SessionDraft, SessionEmployee, SessionService } from './session-types.ts';

/**
 * يتحقق من كل بند قبل رفض الخصم فقط جزئياً، فلا تحفظ مقدمة طلب به مرجع أو نسبة خاطئة.
 *
 * @param drafts مدخلات المال الصحيحة الشكل
 * @param services لقطات الكتالوج في النشاط
 * @param employees حقائق الموظفات عند وقت التنفيذ الأصلي
 * @param userId هوية المسجلة الحالية
 * @returns كل البنود الصحيحة بالترتيب قبل فحص سلطة الخصم
 */
export function prepareSessionLines(drafts: readonly SessionDraft[], services: readonly SessionService[], employees: readonly SessionEmployee[], userId: string): PreparedSessionLine[] {
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  return drafts.map((draft, input_index) => {
    const service = serviceById.get(draft.service_id);
    if (service === undefined) throw new SessionError('SESSION_SERVICE_NOT_FOUND', { input_index, service_id: draft.service_id });
    const shares = validateShares(draft.performers);
    const performers = draft.performers.map((p, index) => {
      const employee = employeeById.get(p.employee_id);
      if (employee === undefined || !employee.eligible) throw new SessionError('SESSION_PERFORMER_NOT_ELIGIBLE', { input_index, employee_id: p.employee_id });
      return { employee, share_bps: shares[index] as number, ...performerWarnings(employee) };
    });
    validateRecorderPerformers(userId, performers.map((p) => p.employee));
    const discount = draft.discount.kind === 'AMOUNT' ? draft.discount.amount : discountFromPercent(draft.price, draft.discount.bps);
    const net = lineNet(draft.price, discount);
    const defaults = equalShares(performers.length);
    return { input_index, service, price: draft.price, discount, net, effective_discount_bps: effectiveDiscountBps(service.price, net), performers,
      has_performer_warning: performers.some((p) => p.not_clocked_in_warning || p.approved_leave_warning),
      explicit_unequal_shares: draft.performers.every((p) => p.share_bps !== undefined) && shares.some((s, i) => s !== defaults[i]) };
  });
}
