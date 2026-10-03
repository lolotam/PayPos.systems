'use client';

import { Label, Select, type SelectOption } from '@pospay/ui';

export function SelectField({
  id,
  label,
  value,
  placeholder,
  options,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value?: string | undefined;
  placeholder: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        value={value}
        placeholder={placeholder}
        options={options}
        onValueChange={onChange}
        disabled={disabled || options.length === 0}
      />
    </div>
  );
}
