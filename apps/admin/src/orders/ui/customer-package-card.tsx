'use client';
import type { CustomerPackageListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge, Card } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { packageName, packageMoney, provenanceKey } from '../model/customer-package-view';

/**
 * كارت الباقة في القايمة: الاسم والأصل والانتهاء وعلامتا الانتهاء والاستنفاد والمبالغ،
 * ولكل مكوّن اسمه والعدّادات الثلاثة بقيم الخانات. الترتيب بيرجع من الخادم زي ما هو (FR-A04).
 */
export function CustomerPackageCard({
  item,
  onSelect,
  selected,
}: {
  item: CustomerPackageListItem;
  onSelect: (entitlementId: string) => void;
  selected: boolean;
}) {
  const locale = useLocale();
  return (
    <Card className="grid gap-2 p-3 text-start">
      <button
        type="button"
        className="text-start font-semibold underline decoration-dotted"
        aria-expanded={selected}
        onClick={() => onSelect(item.id)}
      >
        {packageName(locale, item)}
      </button>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{t(locale, provenanceKey(item.provenance))}</Badge>
        <span>
          {t(locale, 'customerPackages.expiresOn')} <bdi dir="ltr">{item.expires_on}</bdi>
        </span>
        {item.expired ? (
          <Badge variant="warning">{t(locale, 'customerPackages.expiredBadge')}</Badge>
        ) : null}
        {item.used_up ? (
          <Badge variant="warning">{t(locale, 'customerPackages.usedUpBadge')}</Badge>
        ) : null}
      </div>
      <p>
        {t(locale, 'customerPackages.pricePaid')}{' '}
        <bdi dir="ltr">{packageMoney(item.price_paid)}</bdi>
      </p>
      <p>
        {t(locale, 'customerPackages.refundedAmount')}{' '}
        <bdi dir="ltr">{packageMoney(item.refunded_amount)}</bdi>
      </p>
      <CardComponents components={item.components} />
    </Card>
  );
}

function CardComponents({ components }: { components: CustomerPackageListItem['components'] }) {
  const locale = useLocale();
  return (
    <ul className="grid gap-1">
      {components.map((component) => (
        <li key={component.id} className="grid gap-1">
          <span>{packageName(locale, component)}</span>
          <span className="flex flex-wrap gap-2">
            <span>
              {t(locale, 'customerPackages.remaining').replace('{n}', String(component.remaining))}
            </span>
            <span>
              {t(locale, 'customerPackages.usedCount').replace('{n}', String(component.used))}
            </span>
            <span>
              {t(locale, 'customerPackages.refundedCount').replace(
                '{n}',
                String(component.refunded),
              )}
            </span>
          </span>
          <span className="flex flex-wrap gap-2">
            {component.slot_values.map((slot, position) => (
              <span key={position}>
                <bdi dir="ltr">{packageMoney(slot.unit_value)}</bdi>
                {' · '}
                {t(locale, 'customerPackages.slotFree')} {slot.free} ·{' '}
                {t(locale, 'customerPackages.slotUsed')} {slot.used} ·{' '}
                {t(locale, 'customerPackages.slotRefunded')} {slot.refunded}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
