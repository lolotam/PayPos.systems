'use client';
import type { CustomerPackageDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { paidMethodKey, packageMoney } from '../model/customer-package-view';

/**
 * حقول بيع الباقة: بتظهر بس اللي رجعت من القراءة غير null (FR-A05)،
 * ومعرفات البائع والفرع والنوع ما بتتعرضش (FR-A09) والمبالغ نصوص عرض من القراءة بس.
 */
export function DetailSaleFacts({ data }: { data: CustomerPackageDetail }) {
  const locale = useLocale();
  const method = paidMethodKey(data.paid_method);
  const validity =
    data.validity_days === null
      ? null
      : t(locale, 'customerPackages.days').replace('{n}', String(data.validity_days));
  return (
    <div className="grid gap-1">
      {data.list_price !== null ? (
        <p>
          {t(locale, 'customerPackages.listPrice')} <bdi dir="ltr">{packageMoney(data.list_price)}</bdi>
        </p>
      ) : null}
      {data.discount !== null ? (
        <p>
          {t(locale, 'customerPackages.discount')} <bdi dir="ltr">{packageMoney(data.discount)}</bdi>
        </p>
      ) : null}
      <p>
        {t(locale, 'customerPackages.pricePaid')} <bdi dir="ltr">{packageMoney(data.price_paid)}</bdi>
      </p>
      {method !== null ? <p>{t(locale, method)}</p> : null}
      {data.sold_business_date !== null ? (
        <p>
          {t(locale, 'customerPackages.saleDate')} <bdi dir="ltr">{data.sold_business_date}</bdi>
        </p>
      ) : null}
      {validity !== null ? (
        <p>
          {t(locale, 'customerPackages.validityDays')} <bdi dir="ltr">{validity}</bdi>
        </p>
      ) : null}
      <p>
        {t(locale, 'customerPackages.expiresOn')} <bdi dir="ltr">{data.expires_on}</bdi>
      </p>
      <p>
        {t(locale, 'customerPackages.refundedAmount')}{' '}
        <bdi dir="ltr">{packageMoney(data.refunded_amount)}</bdi>
      </p>
    </div>
  );
}
