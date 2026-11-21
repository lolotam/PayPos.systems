'use client';
import type { CustomerPackageDetailComponent } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { componentName, packageMoney, slotLabelKey } from '../model/customer-package-view';

/**
 * مكوّنات الباقة في التفصيل: لكل خدمة العدد الإجمالي والعدّادات والقيمة، ثم كل خانة برقمها
 * وحالتها وقيمتها (FR-A05). حالة الخانة بتأتي من الخادم والعرض بس هنا.
 */
export function CustomerPackageComponents({
  components,
}: {
  components: readonly CustomerPackageDetailComponent[];
}) {
  const locale = useLocale();
  return (
    <ol className="grid gap-3 ps-4">
      {components.map((component) => (
        <li key={component.id} className="grid gap-1">
          <span className="font-semibold">{componentName(locale, component)}</span>
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
            <span>
              {t(locale, 'customerPackages.slotValue')}{' '}
              <bdi dir="ltr">{packageMoney(component.component_value)}</bdi>
            </span>
          </span>
          <ul className="grid gap-1 ps-4">
            {component.slots.map((slot) => (
              <li key={slot.ordinal} className="flex flex-wrap gap-2">
                <span>
                  {t(locale, 'serviceSessions.packageHistorySession').replace(
                    '{n}',
                    String(slot.ordinal),
                  )}
                </span>
                <span>{t(locale, slotLabelKey(slot.state))}</span>
                <span>
                  <bdi dir="ltr">{packageMoney(slot.unit_value)}</bdi>
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
