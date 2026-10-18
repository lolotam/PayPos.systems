'use client';
import type { SetEmployeeNumberInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useEffect, useId, useRef, type ChangeEvent, type KeyboardEvent } from 'react';
import { useForm, type UseFormRegisterReturn, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import {
  employeeNumberFieldOptions,
  employeeNumberFieldText,
  employeeNumberResolver,
} from '../../model/employee-number-form-schema';

type NumberForm = UseFormReturn<SetEmployeeNumberInput>;

function closeOnEscape(pending: boolean, onClose: () => void, event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== 'Escape' || pending) return;
  event.preventDefault();
  onClose();
}

function clearOnChange(
  form: NumberForm,
  registered: UseFormRegisterReturn<'employee_number'>,
  event: ChangeEvent<HTMLInputElement>,
) {
  void registered.onChange(event);
  form.clearErrors('employee_number');
}

function bindNumberField(
  field: { current: HTMLInputElement | null },
  registered: UseFormRegisterReturn<'employee_number'>,
) {
  return (element: HTMLInputElement | null) => {
    field.current = element;
    registered.ref(element);
  };
}

export function CompanyEmployeeNumberEditor({
  current,
  pending,
  message,
  onSubmit,
  onClose,
  rootRef,
}: {
  current: number | null;
  pending: boolean;
  message: string | null;
  onSubmit: (employeeNumber: number) => void;
  onClose: () => void;
  rootRef: (node: HTMLFormElement | null) => void;
}) {
  const locale = useLocale();
  const fieldId = useId();
  const invalid = t(locale, 'companyEmployeeNumbers.invalid');
  const form = useForm<SetEmployeeNumberInput>({ resolver: employeeNumberResolver });
  const registered = form.register('employee_number', employeeNumberFieldOptions);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  const invalidText = employeeNumberFieldText(form.formState.errors.employee_number, invalid);
  return (
    <form
      ref={rootRef}
      onSubmit={form.handleSubmit((body) => onSubmit(body.employee_number))}
      onKeyDown={(event) => closeOnEscape(pending, onClose, event)}
      className="flex max-w-xs flex-col gap-2"
    >
      <fieldset disabled={pending} className="flex flex-col gap-2 border-0 p-0">
        <Label htmlFor={fieldId}>{t(locale, 'companyEmployeeNumbers.number')}</Label>
        <Input
          id={fieldId}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={invalidText !== null}
          {...registered}
          ref={bindNumberField(field, registered)}
          onChange={(event) => clearOnChange(form, registered, event)}
          aria-describedby={invalidText ? `${fieldId}-error` : undefined}
          defaultValue={current === null ? '' : String(current)}
        />
        {invalidText ? <p id={`${fieldId}-error`} role="alert">{invalidText}</p> : null}
        {message ? <p role="alert">{message}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            {t(locale, 'companyEmployeeNumbers.save')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            {t(locale, 'companyEmployeeNumbers.close')}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
