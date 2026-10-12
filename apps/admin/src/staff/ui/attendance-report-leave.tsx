'use client';
import type { AttendanceMonthlyReportRow } from '@pospay/contracts';
import { attendanceHoursMinutes } from '@pospay/domain';
import { t, type MessageKey } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

const labels: Record<
  AttendanceMonthlyReportRow['leave'][number]['type'],
  { days: MessageKey; partial: MessageKey }
> = {
  ANNUAL: {
    days: 'attendanceReport.annualLeaveDays',
    partial: 'attendanceReport.annualPartialLeaveHours',
  },
  SICK: {
    days: 'attendanceReport.sickLeaveDays',
    partial: 'attendanceReport.sickPartialLeaveHours',
  },
  UNPAID: {
    days: 'attendanceReport.unpaidLeaveDays',
    partial: 'attendanceReport.unpaidPartialLeaveHours',
  },
  OTHER: {
    days: 'attendanceReport.otherLeaveDays',
    partial: 'attendanceReport.otherPartialLeaveHours',
  },
};
export function AttendanceReportLeave({ leave }: { leave: AttendanceMonthlyReportRow['leave'] }) {
  const locale = useLocale();
  return (
    <dl className="grid min-w-48 gap-1 text-xs">
      {leave.map((item) => (
        <div key={item.type}>
          <dt>{t(locale, labels[item.type].days)}</dt>
          <dd>{item.days}</dd>
          <dt>{t(locale, labels[item.type].partial)}</dt>
          <dd>
            <span dir="ltr">{attendanceHoursMinutes(item.partial_minutes)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
