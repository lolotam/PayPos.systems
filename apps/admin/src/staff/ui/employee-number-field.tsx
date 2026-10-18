'use client';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function EmployeeNumberField({
  shown,
  draft,
  invalid,
  message,
  onChange,
}: {
  shown: boolean;
  draft: string;
  invalid: boolean;
  message: string | null;
  onChange: (value: string) => void;
}) {
  const locale = useLocale();
  if (!shown) return null;
  const alert = invalid ? t(locale, 'staff.numberInvalid') : message;
  return (
    <>
      <Label htmlFor="employee-number">{t(locale, 'staff.employeeNumber')}</Label>
      <Input
        id="employee-number"
        dir="ltr"
        inputMode="numeric"
        value={draft}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-sm text-muted-foreground">{t(locale, 'staff.numberHint')}</p>
      {alert ? <p role="alert">{alert}</p> : null}
    </>
  );
}
