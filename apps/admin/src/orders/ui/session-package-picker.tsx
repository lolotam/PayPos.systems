'use client';
import { t } from '@pospay/i18n';
import { Badge, Label } from '@pospay/ui';
import { useId } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from '../api/use-session-services';
import type { PackageOption } from '../model/session-package-options';
import { PackageRedemptionHistory } from './package-redemption-history';

export function SessionPackagePicker({ options, value, onChange, scope, customerId, suggestedId, row }: {
  options: PackageOption[];
  value: string | null;
  onChange: (id: string) => void;
  scope: SessionServiceScope;
  customerId: string;
  suggestedId: string | null;
  row: number;
}) {
  const locale = useLocale();
  const groupName = `${useId()}-package-${row}`;
  return <div role="radiogroup" aria-label={t(locale, 'serviceSessions.packagePicker')} className="grid gap-2 text-start">
    {options.map((option) => <div key={option.id} className="grid gap-2">
      <Label className="grid gap-1 rounded-md border p-3">
        <span className="flex flex-wrap items-center gap-2">
          <input type="radio" name={groupName} value={option.id} checked={value === option.id}
            disabled={option.remaining === 0} onChange={() => onChange(option.id)} />
          <span>{locale === 'ar' ? option.name_ar ?? option.name_en : option.name_en}</span>
          {option.id === suggestedId ? <Badge>{t(locale, 'serviceSessions.packageSuggested')}</Badge> : null}
          {option.expired ? <Badge>{t(locale, 'serviceSessions.packageExpired')}</Badge> : null}
        </span>
        <span>{t(locale, 'serviceSessions.packageExpiresOn').replace('{date}', '')}<bdi dir="ltr">{option.expires_on}</bdi></span>
        <span>{t(locale, 'serviceSessions.packageRemaining').replace('{n}', String(option.remaining))}</span>
      </Label>
      {value === option.id ? <PackageRedemptionHistory scope={scope} customerId={customerId} entitlementId={option.id} /> : null}
    </div>)}
  </div>;
}
