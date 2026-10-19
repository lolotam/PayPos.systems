'use client';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useId } from 'react';
import { useLocale } from '@/shared/locale/locale-context';

export function EmployeeListSearch({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const locale = useLocale();
  const id = useId();
  return (
    <div className="flex max-w-sm flex-col gap-2 text-start">
      <Label htmlFor={id}>{t(locale, 'staff.search')}</Label>
      <Input
        id={id}
        type="search"
        maxLength={100}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
