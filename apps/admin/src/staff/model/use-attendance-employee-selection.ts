'use client';
import type { AttendanceEmployeePage } from '@pospay/contracts';
import { useEffect, useState } from 'react';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceEmployeeEligibility } from '../api/use-attendance-employee-eligibility';
import type { useAttendanceEmployees } from '../api/use-attendance-employees';
import { attendancePages } from './attendance-action-display';
import { boardAccessLost } from './attendance-board-display';

type Employee = AttendanceEmployeePage['items'][number];
export function useAttendanceEmployeeSelection(
  scope: AttendanceBoardScope,
  date: string | undefined,
  employeeId: string,
  query: ReturnType<typeof useAttendanceEmployees>,
  onClear: () => void,
) {
  const scopeKey = JSON.stringify(scope);
  const [selection, setSelection] = useState<{ employee: Employee; scopeKey: string }>();
  const items = boardAccessLost(query.error) ? [] : attendancePages(query.data?.pages);
  const current = items.find((row) => row.id === employeeId);
  const selected =
    selection?.scopeKey === scopeKey && selection.employee.id === employeeId
      ? selection.employee
      : undefined;
  const needsCheck = Boolean(employeeId && !current && query.isSuccess && query.hasNextPage);
  const eligibility = useAttendanceEmployeeEligibility(scope, selected, date, needsCheck);
  useEffect(() => {
    if (current) setSelection({ employee: current, scopeKey });
  }, [current, scopeKey]);
  useEffect(() => {
    if (
      employeeId &&
      (boardAccessLost(query.error) ||
        boardAccessLost(eligibility.error) ||
        (query.isSuccess &&
          !query.isFetching &&
          !current &&
          (!query.hasNextPage ||
            (needsCheck && eligibility.isSuccess && !eligibility.isFetching && !eligibility.data))))
    )
      onClear();
  }, [
    employeeId,
    query.error,
    query.isSuccess,
    query.isFetching,
    query.hasNextPage,
    current,
    needsCheck,
    eligibility.error,
    eligibility.isSuccess,
    eligibility.isFetching,
    eligibility.data,
    onClear,
  ]);
  return !current &&
    selected &&
    !boardAccessLost(query.error) &&
    !boardAccessLost(eligibility.error)
    ? [...items, selected]
    : items;
}
