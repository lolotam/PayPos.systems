import type { ChangeLinePerformersResponse, ServiceSessionDayPage } from '@pospay/contracts';

type DayLine = ServiceSessionDayPage['items'][number]['lines'][number];
export type PerformersChangedSource = Extract<
  ChangeLinePerformersResponse,
  { line: unknown }
>['line'];

// صف اليوم بيعرض رد التغيير نفسه لو جلب اليوم التالي فشل، عشان العلامة وتاريخها يبانوا من غير ما المدير يحدّث.
// إعادة رد قديم بنفس المفتاح ممكن توصل بعد تغيير أحدث؛ مراجعة الكاش الأعلى تكسب عشان السطر ما يرجعش لورا.
export function applyPerformersChangedLine(line: DayLine, next: PerformersChangedSource): DayLine {
  if (line.revision > next.revision) return line;
  return {
    ...line,
    revision: next.revision,
    performers_changed_at: next.performers_changed_at,
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
