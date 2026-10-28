'use client';
import { t } from '@pospay/i18n';
import { Button, Label, NativeSelect } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import {
  statementEmployeeName,
  type StatementDraft,
  type StatementDraftPatch,
  type StatementEmployee,
} from '../model/attendance-statement-display';

/** فلتر الموظفة: اختياري في كشف الفرع، وإلزامي في كشف الموظفة. */
export function AttendanceStatementEmployeeField(props: {
  draft: StatementDraft;
  employees: StatementEmployee[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onChange: (patch: StatementDraftPatch) => void;
}) {
  const locale = useLocale();
  const { draft, employees } = props;
  return (
    <div className="grid gap-1">
      <Label htmlFor="statement-employee">
        {t(
          locale,
          draft.form === 'EMPLOYEE'
            ? 'attendanceStatementScreen.employeeRequired'
            : 'attendanceStatementScreen.employeeOptional',
        )}
      </Label>
      <NativeSelect
        id="statement-employee"
        value={draft.employeeId}
        onChange={(event) => props.onChange({ employeeId: event.target.value })}
      >
        <option value="">{t(locale, 'attendanceStatementScreen.chooseEmployee')}</option>
        {employees.map((employee) => (
          <option key={employee.employee_id} value={employee.employee_id}>
            {employee.employee_number} — {statementEmployeeName(employee, locale)}
          </option>
        ))}
      </NativeSelect>
      {props.loading ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {!props.loading && props.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <p>{t(locale, 'attendanceStatementScreen.employeesFailed')}</p>
          <Button variant="outline" onClick={props.onRetry}>
            {t(locale, 'attendanceStatementScreen.checkAgain')}
          </Button>
        </div>
      ) : null}
      {!props.loading && !props.error && employees.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(locale, 'attendanceStatementScreen.noEmployees')}
        </p>
      ) : null}
    </div>
  );
}
