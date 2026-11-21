'use client';
import type { CustomerPackageListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { packageName, packageMoney } from '../model/customer-package-view';

/** مكوّنات كارت الباقة في القايمة: الاسم والعدّادات الثلاثة وقيم الخانات مجمعة بالحالة. */
export function CardComponents({
  components,
}: {
  components: CustomerPackageListItem['components'];
}) {
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
              {t(locale, 'customerPackages.refundedCount').replace('{n}', String(component.refunded))}
            </span>
          </span>
          <span className="flex flex-wrap gap-2">
            {component.slot_values.map((slot, position) => (
              <span key={position}>
                <bdi dir="ltr">{packageMoney(slot.unit_value)}</bdi>
                {' · '}
                {t(locale, 'customerPackages.slotFree')} {slot.free} · {t(locale, 'customerPackages.slotUsed')}{' '}
                {slot.used} · {t(locale, 'customerPackages.slotRefunded')} {slot.refunded}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
