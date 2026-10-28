'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { t, type Locale, type MessageKey } from '@pospay/i18n';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import {
  statementBranchName,
  type StatementDraft,
  type StatementDraftPatch,
  type StatementEmployee,
  type StatementForm,
  type StatementLanguage,
  type StatementShift,
} from '../model/attendance-statement-display';
import { AttendanceStatementEmployeeField } from './attendance-statement-employee-field';
import { AttendanceStatementPeriodFields } from './attendance-statement-period-fields';
import { AttendanceStatementShiftField } from './attendance-statement-shift-field';

const RADIO_CLASS = 'h-4 w-4 min-h-0 ps-0 pe-0 py-0';

const FORM_OPTIONS = [
  { value: 'BRANCH', label: 'attendanceStatementScreen.formBranch' },
  { value: 'EMPLOYEE', label: 'attendanceStatementScreen.formEmployee' },
] as const satisfies readonly { value: StatementForm; label: MessageKey }[];

const LANGUAGE_OPTIONS = [
  { value: 'ar', label: 'attendanceStatementScreen.languageArabic' },
  { value: 'en', label: 'attendanceStatementScreen.languageEnglish' },
] as const satisfies readonly { value: StatementLanguage; label: MessageKey }[];

type Props = {
  branches: WorkspaceBranch[];
  branchId: string;
  draft: StatementDraft;
  shifts: StatementShift[];
  employees: StatementEmployee[];
  employeesLoading: boolean;
  employeesError: unknown;
  onEmployeesRetry: () => void;
  periodValid: boolean;
  locked: boolean;
  submitting: boolean;
  onBranch: (branchId: string) => void;
  onChange: (patch: StatementDraftPatch) => void;
  onSubmit: () => void;
};

/** مجموعة أزرار اختيار واحدة — بتستخدم في نوع الكشف ولغة الكشف. */
function radioField<T extends string>(
  legend: string,
  name: string,
  options: readonly { value: T; label: MessageKey }[],
  checked: T,
  onPick: (value: T) => void,
  locale: Locale,
) {
  return (
    <fieldset className="grid gap-1">
      <legend className="text-start text-sm font-medium">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm">
          <Input
            id={`statement-${name}-${option.value.toLowerCase()}`}
            name={`statement-${name}`}
            type="radio"
            className={RADIO_CLASS}
            checked={checked === option.value}
            onChange={() => onPick(option.value)}
          />
          {t(locale, option.label)}
        </label>
      ))}
    </fieldset>
  );
}

function statementCanSubmit(props: Props) {
  const employeeConfirmed =
    !props.draft.employeeId ||
    props.employees.some((employee) => employee.employee_id === props.draft.employeeId);
  return (
    props.periodValid &&
    employeeConfirmed &&
    (props.draft.form !== 'EMPLOYEE' || Boolean(props.draft.employeeId))
  );
}

/** نموذج طلب الكشف: الفرع، النوع، الفترة، الموظفة، الشيفت، اللغة، وزر الطلب. */
export function AttendanceStatementForm(props: Props) {
  const locale = useLocale();
  const { branches, draft, shifts, employees } = props;
  const formLegend = t(locale, 'attendanceStatementScreen.form');
  const langLegend = t(locale, 'attendanceStatementScreen.language');
  const pickForm = (form: StatementForm) => props.onChange({ form });
  const pickLanguage = (language: StatementLanguage) => props.onChange({ language });
  const canSubmit = statementCanSubmit(props);
  return (
    <fieldset disabled={props.locked || props.submitting} className="flex flex-col gap-4">
      <div className="grid gap-1">
        <Label htmlFor="statement-branch">{t(locale, 'attendanceStatementScreen.branch')}</Label>
        <NativeSelect
          id="statement-branch"
          value={props.branchId}
          onChange={(event) => props.onBranch(event.target.value)}
        >
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {statementBranchName(branch, locale)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {radioField(formLegend, 'form', FORM_OPTIONS, draft.form, pickForm, locale)}
      <AttendanceStatementPeriodFields
        draft={draft}
        valid={props.periodValid}
        onChange={props.onChange}
      />
      <AttendanceStatementEmployeeField
        draft={draft}
        employees={employees}
        loading={props.employeesLoading}
        error={props.employeesError}
        onRetry={props.onEmployeesRetry}
        onChange={props.onChange}
      />
      {draft.form === 'BRANCH' && shifts.length > 0 ? (
        <AttendanceStatementShiftField draft={draft} shifts={shifts} onChange={props.onChange} />
      ) : null}
      {radioField(langLegend, 'language', LANGUAGE_OPTIONS, draft.language, pickLanguage, locale)}
      <Button
        type="submit"
        disabled={props.locked || props.submitting || !canSubmit}
        aria-busy={props.submitting}
        onClick={props.onSubmit}
      >
        {t(
          locale,
          props.submitting
            ? 'attendanceStatementScreen.submitting'
            : 'attendanceStatementScreen.submit',
        )}
      </Button>
    </fieldset>
  );
}
