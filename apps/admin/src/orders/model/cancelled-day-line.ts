import type { CancelServiceLineResponse, ServiceSessionDayPage } from '@pospay/contracts';

type DayLine = ServiceSessionDayPage['items'][number]['lines'][number];
export type CancelledDaySource = Extract<CancelServiceLineResponse, { line: unknown }>['line'];

// صف اليوم بيعرض رد الإلغاء نفسه لو جلب اليوم التالي فشل؛ حقول الجلسة الزيادة ما لهاش مكان في الصف.
export function applyCancelledLine(line: DayLine, next: CancelledDaySource): DayLine {
  return {
    ...line,
    service_id: next.service_id,
    ordinal: next.ordinal,
    name_ar: next.name_ar,
    name_en: next.name_en,
    status: next.status,
    revision: next.revision,
    edited: next.edited ?? line.edited,
    cancelled_at: next.cancelled_at,
    list_price: next.list_price,
    price: next.price,
    discount: next.discount,
    net: next.net,
    effective_discount_bps: next.effective_discount_bps,
    recorded_by: next.recorded_by,
    recorded_at: next.recorded_at,
    late: next.late,
    has_performer_warning: next.has_performer_warning,
    performers: next.performers.map((performer) => ({
      employee_id: performer.employee_id,
      name_ar: performer.name_ar,
      name_en: performer.name_en,
      share_bps: performer.share_bps,
      not_clocked_in_warning: performer.not_clocked_in_warning,
      approved_leave_warning: performer.approved_leave_warning,
    })),
  };
}
