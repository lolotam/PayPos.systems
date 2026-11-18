import type { SellablePackageType } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { formatKwd, t } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useId } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from '../api/use-session-services';
import { useSellablePackageTypes } from '../api/use-sellable-package-types';

export function usePackageSaleTypeOptions(
  scope: SessionServiceScope,
  value: SellablePackageType | null,
  onChange: (type: SellablePackageType) => void,
  disabled: boolean,
) {
  const locale = useLocale();
  const groupName = useId();
  const query = useSellablePackageTypes(scope, !disabled);
  const items = query.data?.items ?? [];
  const options = items.map((type) => (
    <Label key={type.id} className="grid gap-2 rounded-interactive border p-3">
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name={groupName}
          value={type.id}
          checked={value?.id === type.id}
          onChange={() => onChange(type)}
        />
        <span>{locale === 'ar' ? (type.name_ar ?? type.name_en) : type.name_en}</span>
      </span>
      <span>
        {t(locale, 'packageSale.price')} <bdi dir="ltr">{formatKwd(parseMoney(type.price))}</bdi>
      </span>
      <span>
        {t(locale, 'packageSale.validityDays').replace('{days}', String(type.validity_days))}
      </span>
      <ul className="grid gap-1 ps-5">
        {type.components.map((component) => (
          <li key={component.service_id}>
            {locale === 'ar' ? (component.name_ar ?? component.name_en) : component.name_en}
            {' · '}
            {t(locale, 'packageSale.componentSessions').replace(
              '{sessions}',
              String(component.sessions),
            )}
            {' · '}
            {t(locale, 'packageSale.price')}{' '}
            <bdi dir="ltr">{formatKwd(parseMoney(component.list_price))}</bdi>
          </li>
        ))}
      </ul>
    </Label>
  ));
  const refreshed = value === null ? undefined : items.find((type) => type.id === value.id);
  const quoteChanged =
    refreshed !== undefined && JSON.stringify(refreshed) !== JSON.stringify(value);
  return { locale, query, options, refreshed, quoteChanged };
}
