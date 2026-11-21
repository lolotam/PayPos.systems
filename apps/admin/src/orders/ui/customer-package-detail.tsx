'use client';
import type { CustomerPackageDetail as DetailData } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useCustomerPackageDetail } from '../api/use-customer-package-detail';
import type { SessionServiceScope } from '../api/use-session-services';
import { paidMethodKey, packageMoney, provenanceKey } from '../model/customer-package-view';
import { CustomerPackageComponents } from './customer-package-components';
import { ExtendPackageDialog } from './extend-package-dialog';
import { PackageExtensionHistory } from './package-extension-history';
import { PackageRedemptionList } from './package-redemption-list';

/**
 * تفصيل الباقة المستقل: حالات التحميل و404 و403 والفشل بإعادة منفصلة عن القايمة (FR-A07).
 * حقول البيع بتظهر بس اللي رجعت من القراءة غير null، ومعرفات البائع والفرع والنوع ما بتتعرضش (FR-A09)،
 * وزر التمديد بيتبع can_extend من الخادم بس (BR-A2).
 */
export function CustomerPackageDetail({
  scope,
  customerId,
  entitlementId,
  onClose,
}: {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string;
  onClose: () => void;
}) {
  const locale = useLocale();
  const [dialogOpen, setDialogOpen] = useState(false);
  const detail = useCustomerPackageDetail(scope, customerId, entitlementId);
  if (detail.isLoading) return <p role="status">{t(locale, 'customerPackages.detailLoading')}</p>;
  if (detail.isError)
    return <DetailFailure error={detail.error} onRetry={() => void detail.refetch()} />;
  const data = detail.data;
  if (data === undefined) return null;
  return (
    <section
      className="grid gap-3 rounded-card border border-border p-3 text-start"
      aria-label={t(locale, 'customerPackages.title')}
    >
      <DetailHeader data={data} onClose={onClose} />
      <DetailSaleFacts data={data} />
      <section className="grid gap-2" aria-label={t(locale, 'customerPackages.components')}>
        <h3 className="font-semibold">{t(locale, 'customerPackages.components')}</h3>
        <CustomerPackageComponents components={data.components} />
      </section>
      <section className="grid gap-2" aria-label={t(locale, 'customerPackages.redemptions')}>
        <h3 className="font-semibold">{t(locale, 'customerPackages.redemptions')}</h3>
        <PackageRedemptionList redemptions={data.redemptions} components={data.components} />
      </section>
      <PackageExtensionHistory extensions={data.extensions} timeZone={data.business_timezone} />
      {data.can_extend ? (
        <Button type="button" onClick={() => setDialogOpen(true)}>
          {t(locale, 'customerPackages.extend')}
        </Button>
      ) : null}
      {dialogOpen && data.can_extend ? (
        <ExtendPackageDialog
          scope={scope}
          customerId={customerId}
          entitlementId={entitlementId}
          currentExpiresOn={data.expires_on}
          onSaved={() => {
            void detail.refetch();
            setDialogOpen(false);
          }}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </section>
  );
}

function DetailFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const locale = useLocale();
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: unknown }).status
      : undefined;
  const messageKey =
    status === 404
      ? 'customerPackages.detailNotFound'
      : status === 403
        ? 'customerPackages.detailNotAllowed'
        : 'customerPackages.detailLoadFailed';
  return (
    <p role="alert">
      {t(locale, messageKey)}{' '}
      {status === 403 || status === 404 ? null : (
        <Button type="button" variant="outline" onClick={onRetry}>
          {t(locale, 'customerPackages.detailRetry')}
        </Button>
      )}
    </p>
  );
}

function DetailHeader({ data, onClose }: { data: DetailData; onClose: () => void }) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="font-semibold">
        {locale === 'ar' ? (data.name_ar ?? data.name_en) : data.name_en}
      </h2>
      <span>{t(locale, provenanceKey(data.provenance))}</span>
      <Button type="button" variant="outline" onClick={onClose}>
        {t(locale, 'customerPackages.close')}
      </Button>
    </div>
  );
}

function DetailSaleFacts({ data }: { data: DetailData }) {
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
          {t(locale, 'customerPackages.listPrice')}{' '}
          <bdi dir="ltr">{packageMoney(data.list_price)}</bdi>
        </p>
      ) : null}
      {data.discount !== null ? (
        <p>
          {t(locale, 'customerPackages.discount')}{' '}
          <bdi dir="ltr">{packageMoney(data.discount)}</bdi>
        </p>
      ) : null}
      <p>
        {t(locale, 'customerPackages.pricePaid')}{' '}
        <bdi dir="ltr">{packageMoney(data.price_paid)}</bdi>
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
