'use client';
import { t } from '@pospay/i18n';
import { Label } from '@pospay/ui';

import type { FieldProps, Registration } from './customer-profile-controls';

export function GenderChoice({
  id,
  locale,
  describedBy,
  registration,
  invalid,
}: FieldProps & { registration: Registration; invalid: boolean }) {
  return (
    <>
      <div role="radiogroup" aria-label={t(locale, 'serviceSessions.gender')} className="flex flex-wrap gap-4">
        {(['female', 'male'] as const).map((value) => (
          <span key={value} className="flex items-center gap-1">
            <input
              type="radio"
              id={`${id}-gender-${value}`}
              value={value}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              {...registration}
            />
            <Label htmlFor={`${id}-gender-${value}`}>
              {t(locale, value === 'female' ? 'serviceSessions.genderFemale' : 'serviceSessions.genderMale')}
            </Label>
          </span>
        ))}
      </div>
      <p className="text-xs opacity-80">{t(locale, 'serviceSessions.genderRequiredForNew')}</p>
    </>
  );
}
