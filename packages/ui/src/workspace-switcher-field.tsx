'use client';

import { Label } from './label.js';
import { Select, type SelectOption } from './select.js';

/**
 * حقل مبدّل مساحة العمل: تسمية فوق مبدّل الكيت؛ القيم والخيارات والتعطيل
 * والتغيير كلها قرار المستدعي وتمرّ هنا كما وصلت.
 */
export function WorkspaceSwitcherField({
  id,
  label,
  value,
  options,
  disabled,
  onValueChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  disabled?: boolean | undefined;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        value={value}
        onValueChange={onValueChange}
        options={options}
        {...(disabled === undefined ? {} : { disabled })}
      />
    </div>
  );
}
