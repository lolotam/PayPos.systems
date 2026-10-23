'use client';

import type { StaffColumnCode } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge, Label } from '@pospay/ui';
import { useController } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { offeredStaffColumns } from '../model/offered-staff-columns';
import type { StaffColumnsDraft } from '../model/staff-columns-save-body';

export function StaffColumnCheckboxes({ defaultInEffect }: { defaultInEffect: boolean }) {
  const locale = useLocale();
  const { field } = useController<StaffColumnsDraft>({ name: 'columns' });
  const selected = field.value ?? [];
  const toggle = (code: StaffColumnCode) => {
    const next = selected.includes(code)
      ? selected.filter((chosen) => chosen !== code)
      : [...selected, code];
    field.onChange(offeredStaffColumns().filter((offered) => next.includes(offered)));
  };
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="flex items-center gap-2 text-sm font-semibold">
        {t(locale, 'staffAppColumns.columnsTitle')}
        {defaultInEffect ? (
          <Badge variant="secondary">{t(locale, 'staffAppColumns.defaultInEffect')}</Badge>
        ) : null}
      </legend>
      <p className="text-sm text-muted-foreground">
        {t(locale, 'staffAppColumns.columnsHint')}
      </p>
      {offeredStaffColumns().map((code) => {
        const id = `staff-column-${code}`;
        return (
          <div key={code} className="flex items-center gap-3">
            <input
              id={id}
              type="checkbox"
              checked={selected.includes(code)}
              onChange={() => toggle(code)}
            />
            <Label htmlFor={id}>{t(locale, `staffAppColumns.label_${code}`)}</Label>
            <span className="text-sm text-muted-foreground">
              {t(locale, `staffAppColumns.example_${code}`)}
            </span>
          </div>
        );
      })}
    </fieldset>
  );
}
