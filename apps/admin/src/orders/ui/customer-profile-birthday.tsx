'use client';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';

import type { FieldProps, Registration } from './customer-profile-controls';

export function BirthdayFields({
  id,
  locale,
  describedBy,
  invalid,
  day,
  month,
  year,
}: FieldProps & { day: Registration; month: Registration; year: Registration; invalid: boolean }) {
  return (
    <>
      <p className="text-sm font-medium">{t(locale, 'serviceSessions.birthday')}</p>
      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor={`${id}-day`}>{t(locale, 'serviceSessions.birthdayDay')}</Label>
          <Input id={`${id}-day`} inputMode="numeric" autoComplete="off" aria-invalid={invalid} aria-describedby={describedBy} {...day} />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor={`${id}-month`}>{t(locale, 'serviceSessions.birthdayMonth')}</Label>
          <Input id={`${id}-month`} inputMode="numeric" autoComplete="off" aria-invalid={invalid} aria-describedby={describedBy} {...month} />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor={`${id}-year`}>{t(locale, 'serviceSessions.birthdayYear')}</Label>
          <Input id={`${id}-year`} inputMode="numeric" autoComplete="off" aria-invalid={invalid} aria-describedby={describedBy} {...year} />
        </div>
      </div>
    </>
  );
}
