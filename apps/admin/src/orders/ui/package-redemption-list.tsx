'use client';
import type { CustomerPackageDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { componentName } from '../model/customer-package-view';

type Redemption = CustomerPackageDetail['redemptions'][number];
type Components = CustomerPackageDetail['components'];

/**
 * قائمة الاستخدام التقديمية: نفس صفوف السجل اللي كانت جوه تفاصيل الباقة في النموذج،
 * بتظهر هنا في تفصيل الباقة المستقل. الجلسة ورقمها واسم الخدمة وتاريخ الزيارة وعلامة الإلغاء.
 */
export function PackageRedemptionList({
  redemptions,
  components,
}: {
  redemptions: readonly Redemption[];
  components: Components;
}) {
  const locale = useLocale();
  if (redemptions.length === 0)
    return <p role="status">{t(locale, 'serviceSessions.packageHistoryEmpty')}</p>;
  return (
    <ol className="grid gap-2 ps-4">
      {redemptions.map((redemption) => {
        const component = components.find((row) => row.id === redemption.component_id);
        return (
          <li key={redemption.id} className="grid gap-1">
            <span>
              {t(locale, 'serviceSessions.packageHistorySession').replace(
                '{n}',
                String(redemption.ordinal),
              )}{' '}
              {componentName(locale, component ?? { name_en: '', name_ar: null })}
            </span>
            <span>
              {t(locale, 'serviceSessions.packageHistoryVisit').replace('{date}', '')}
              <bdi dir="ltr">{redemption.visit_business_date}</bdi>
            </span>
            {redemption.reversed_at !== null ? (
              <Badge>{t(locale, 'serviceSessions.packageHistoryReversed')}</Badge>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
