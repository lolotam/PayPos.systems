'use client';
import type { AttendanceChangeRequestInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Label, NativeSelect } from '@pospay/ui';
import type { UseFormRegister } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceEmployees } from '../api/use-attendance-employees';
import { attendancePages } from '../model/attendance-action-display';
import { boardAccessLost } from '../model/attendance-board-display';
import { AttendanceActionFeedback } from './attendance-action-feedback';
export function AttendanceEmployeePicker({
  scope,
  register,
}: {
  scope: AttendanceBoardScope;
  register: UseFormRegister<AttendanceChangeRequestInput>;
}) {
  const locale = useLocale();
  const query = useAttendanceEmployees(scope);
  const items = boardAccessLost(query.error) ? [] : attendancePages(query.data?.pages);
  return (
    <div className="grid gap-2">
      <Label htmlFor="manual-employee">{t(locale, 'attendanceBoard.employee')}</Label>
      <NativeSelect id="manual-employee" {...register('employee_id')}>
        <option value="">{t(locale, 'attendanceActions.chooseEmployee')}</option>
        {items.map((row) => (
          <option key={row.id} value={row.id}>
            {locale === 'ar' ? (row.name_ar ?? row.name_en) : row.name_en}
          </option>
        ))}
      </NativeSelect>
      <AttendanceActionFeedback
        error={query.error}
        loading={query.isPending}
        onRetry={() => {
          void query.refetch();
        }}
      />
      {query.hasNextPage && !boardAccessLost(query.error) ? (
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {t(locale, 'attendanceBoard.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
