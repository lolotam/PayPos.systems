'use client';
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import {
  statementPeriod,
  statementPeriodIsValid,
  type StatementDraft,
} from '../model/attendance-statement-display';
import { useAttendanceStatementEmployees } from './use-attendance-statement-employees';
import type { AttendanceStatementScope } from './use-attendance-statement-request';

type Props = {
  scope: AttendanceStatementScope;
  timezone: string;
};

/** بيطابق اختيار الموظفة مع تغطية الفترة الحالية، من غير ما يبعت فلتر قديم مخفي. */
export function useAttendanceStatementEmployeeSelection(
  draft: StatementDraft,
  setDraft: Dispatch<SetStateAction<StatementDraft>>,
  props: Props,
) {
  const period = statementPeriod(draft);
  const employees = useAttendanceStatementEmployees(
    props.scope,
    period,
    statementPeriodIsValid(period, props.timezone),
  );
  useEffect(() => {
    const employeeId = draft.employeeId;
    if (!employeeId || employees.data === undefined) return;
    if (employees.data.some((employee) => employee.employee_id === employeeId)) return;
    setDraft((current) =>
      current.employeeId === employeeId ? { ...current, employeeId: '' } : current,
    );
  }, [draft.employeeId, employees.data, setDraft]);
  return employees;
}
