'use client';
import { t } from '@pospay/i18n';
import { Label, NativeSelect } from '@pospay/ui';
import type { SortingState, Updater } from '@tanstack/react-table';
import { useLocale } from '@/shared/locale/locale-context';
import { attendanceReportSortOptions } from './attendance-report-columns';

/**
 * مربع الفرز الظاهر تحت 600px فقط: ترويسة الجدول تختفي بصريًا هناك وفيها أزرار الفرز الوحيدة،
 * فيقدّم هذا المربع الأعمدة والاتجاهين نفسها على حالة الفرز نفسها.
 * وعند تفعيل أكثر من فرز من ترويسة الجدول يُعرض الخيار الفارغ، لأن أي اختيار جديد يُحلّ محلّ كل الفرزات.
 */
export function AttendanceReportSortControl({
  sorting,
  onSortingChange,
  disabled,
}: {
  sorting: SortingState;
  onSortingChange: (updater: Updater<SortingState>) => void;
  /** لا جدول ظاهر الآن (رفض أو تحميل): لا شيء يُفرز. */
  disabled: boolean;
}) {
  const locale = useLocale();
  const current = sorting.length === 1 ? sorting[0] : undefined;
  const value = current ? `${current.id}:${current.desc ? 'desc' : 'asc'}` : '';
  return (
    <div className="hidden gap-1 max-[599.99px]:grid">
      <Label htmlFor="report-sort">{t(locale, 'attendanceReport.sortBy')}</Label>
      <NativeSelect
        id="report-sort"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const [id, direction] = event.target.value.split(':');
          onSortingChange(id ? [{ id, desc: direction === 'desc' }] : []);
        }}
      >
        <option value="">{t(locale, 'catalogServices.missingValue')}</option>
        {attendanceReportSortOptions(locale).flatMap(({ id, label }) =>
          (['asc', 'desc'] as const).map((direction) => (
            <option key={`${id}:${direction}`} value={`${id}:${direction}`}>
              {label} —{' '}
              {t(
                locale,
                direction === 'asc'
                  ? 'attendanceReport.sortAscending'
                  : 'attendanceReport.sortDescending',
              )}
            </option>
          )),
        )}
      </NativeSelect>
    </div>
  );
}
