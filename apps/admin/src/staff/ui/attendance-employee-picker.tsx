'use client';
import type { AttendanceChangeRequestInput, AttendanceEmployeePage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label, NativeSelect } from '@pospay/ui';
import { useEffect, useState } from 'react';
import type { UseFormRegister } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceEmployees } from '../api/use-attendance-employees';
import { attendancePages } from '../model/attendance-action-display';
import { boardAccessLost } from '../model/attendance-board-display';
import { AttendanceActionFeedback } from './attendance-action-feedback';
import { AttendanceActionPagination } from './attendance-action-pagination';
type Props = {
  scope: AttendanceBoardScope;
  date: string | undefined;
  register: UseFormRegister<AttendanceChangeRequestInput>;
  employeeId: string;
  onSearchChanged: () => void;
};
function useAttendanceEmployeeSelection(
  employeeId: string,
  pages: AttendanceEmployeePage[] | undefined,
  error: unknown,
  onClear: () => void,
) {
  useEffect(() => {
    if (
      employeeId &&
      (boardAccessLost(error) ||
        (pages && !attendancePages(pages).some((row) => row.id === employeeId)))
    )
      onClear();
  }, [pages, error, employeeId, onClear]);
}
export function AttendanceEmployeePicker({
  scope,
  date,
  register,
  employeeId,
  onSearchChanged,
}: Props) {
  const locale = useLocale();
  const [search, setSearch] = useState('');
  const query = useAttendanceEmployees(scope, search, date);
  const items = boardAccessLost(query.error) ? [] : attendancePages(query.data?.pages);
  useAttendanceEmployeeSelection(employeeId, query.data?.pages, query.error, onSearchChanged);
  return (
    <div className="grid gap-2">
      <Label htmlFor="manual-employee-search">
        {t(locale, 'attendanceActions.searchEmployee')}
      </Label>
      <Input
        id="manual-employee-search"
        type="search"
        maxLength={100}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          onSearchChanged();
        }}
      />
      <Label htmlFor="manual-employee">{t(locale, 'attendanceBoard.employee')}</Label>
      <NativeSelect id="manual-employee" {...register('employee_id')} value={employeeId}>
        <option value="">{t(locale, 'attendanceActions.chooseEmployee')}</option>
        {items.map((row) => (
          <option key={row.id} value={row.id}>
            {locale === 'ar' ? (row.name_ar ?? row.name_en) : row.name_en}
          </option>
        ))}
      </NativeSelect>
      {query.isSuccess && !items.length ? (
        <p role="status">{t(locale, 'attendanceActions.noEmployees')}</p>
      ) : null}
      <AttendanceActionFeedback
        error={query.error}
        loading={query.isPending}
        onRetry={() => {
          void query.refetch();
        }}
      />
      <AttendanceActionPagination
        hasMore={query.hasNextPage && !boardAccessLost(query.error)}
        fetching={query.isFetching}
        onMore={() => {
          void query.fetchNextPage();
        }}
      />
    </div>
  );
}
