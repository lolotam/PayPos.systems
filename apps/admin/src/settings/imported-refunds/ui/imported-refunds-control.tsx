'use client';

import { t } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function ImportedRefundsControl({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const locale = useLocale();
  return (
    <>
      <div className="flex items-center gap-3">
        <input
          id="imported-refunds"
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <Label htmlFor="imported-refunds">
          {t(locale, disabled ? 'importedRefunds.lastConfirmed' : 'importedRefunds.label')}
        </Label>
      </div>
      {!enabled && !disabled ? <p role="status">{t(locale, 'importedRefunds.offNote')}</p> : null}
    </>
  );
}
