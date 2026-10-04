import { addScheduleDays, scheduleInstant, scheduleToday } from './schedule-calendar.ts';
import { LeaveError, type LeaveRecord, type LeaveTerms } from './leave-types.ts';

function validDate(date: string) {
  const at = new Date(`${date}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(at.getTime()) &&
    at.toISOString().slice(0, 10) === date
  );
}
function validatePeriod(input: LeaveTerms, from: string, to: string): void {
  if (!validDate(from) || !validDate(to) || from > to) throw new LeaveError('LEAVE_PERIOD_INVALID');
  if (input.kind === 'FULL_DAY') {
    // الأيام المدنية تُحسب بتواريخ UTC بديلة؛ ساعات التوقيت الصيفي لا تغيّر الحد الشامل.
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > 90) throw new LeaveError('LEAVE_SPAN_TOO_LONG');
    return;
  }
  if (
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.start) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.end) ||
    input.start >= input.end
  )
    throw new LeaveError('LEAVE_PERIOD_INVALID');
  // الخطوة تخص الدقائق المحلية المدخلة قبل تحويل منطقة الفرع إلى UTC.
  if (Number(input.start.slice(3)) % 15 !== 0 || Number(input.end.slice(3)) % 15 !== 0)
    throw new LeaveError('LEAVE_TIME_STEP_INVALID');
}
/**
 * يحفظ الأيام المدنية شاملة النهاية ثم يحولها لفترة UTC نصف مفتوحة؛ الجزء لا يعبر منتصف الليل.
 *
 * @param input الفترة والنوع والملاحظة المدخلة
 * @param timezone منطقة الفرع المتحقق منه
 * @param now الوقت المحقون لتحديد اليوم المحلي
 * @param own هل الطلب ذاتي لتطبيق سياسة الماضي
 * @returns حقول الفترة المحلية واللحظات الثابتة والملاحظة المنقحة
 */
export function materializeLeave(input: LeaveTerms, timezone: string, now: Date, own: boolean) {
  const from = input.kind === 'FULL_DAY' ? input.from : input.date;
  const to = input.kind === 'FULL_DAY' ? input.to : input.date;
  const note = input.note?.trim() ?? null;
  if (
    !['ANNUAL', 'SICK', 'UNPAID', 'OTHER'].includes(input.type) ||
    (note !== null && (note.length < 1 || note.length > 500)) ||
    (input.type === 'OTHER' && note === null)
  )
    throw new LeaveError('LEAVE_NOTE_REQUIRED');
  validatePeriod(input, from, to);
  if (own && from < scheduleToday(now, timezone)) throw new LeaveError('LEAVE_PAST_OWN_FORBIDDEN');
  try {
    const starts_at = scheduleInstant(
      from,
      input.kind === 'PARTIAL' ? input.start : '00:00',
      timezone,
    );
    const ends_at = scheduleInstant(
      input.kind === 'PARTIAL' ? to : addScheduleDays(to, 1),
      input.kind === 'PARTIAL' ? input.end : '00:00',
      timezone,
    );
    if (starts_at >= ends_at) throw new LeaveError('LEAVE_PERIOD_INVALID');
    return {
      kind: input.kind,
      from,
      to,
      start: input.kind === 'PARTIAL' ? input.start : null,
      end: input.kind === 'PARTIAL' ? input.end : null,
      timezone,
      starts_at,
      ends_at,
      type: input.type,
      note,
    };
  } catch (error) {
    if (error instanceof LeaveError) throw error;
    throw new LeaveError('LEAVE_LOCAL_TIME_INVALID');
  }
}
/**
 * يرفض تقاطع فترات الموظف المعلقة أو المعتمدة؛ تلامس النهايات يسمح بطلب مجاور.
 *
 * @param period الفترة الجديدة
 * @param period.starts_at البداية الشاملة
 * @param period.ends_at النهاية المستبعدة
 * @param others الفترات المقارنة لنفس الموظف عبر كل الفروع
 * @returns لا قيمة؛ رفض مسمى عند التقاطع
 */
export function validateLeaveOverlap(
  period: { starts_at: string; ends_at: string },
  others: Pick<LeaveRecord, 'starts_at' | 'ends_at' | 'status'>[],
): void {
  if (
    others.some(
      (row) =>
        ['PENDING', 'APPROVED'].includes(row.status) &&
        period.starts_at < row.ends_at &&
        row.starts_at < period.ends_at,
    )
  )
    throw new LeaveError('LEAVE_OVERLAP');
}
