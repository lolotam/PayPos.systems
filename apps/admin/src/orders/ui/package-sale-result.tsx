'use client';
import type { PackageSaleStatus } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { formatKwd, t } from '@pospay/i18n';
import { Button, Card } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

function packageSaleFailure(
  error: Extract<PackageSaleStatus, { status: 'failed' }>['error'],
  locale: 'ar' | 'en',
) {
  const value = error.details;
  const details =
    value == null ? null : typeof value === 'string' ? value : (JSON.stringify(value) ?? null);
  return (
    <div role="alert" className="grid gap-1 text-start">
      <p>{locale === 'ar' ? error.message_ar : error.message_en}</p>
      {details ? (
        <p>
          {t(locale, 'packageSale.details')} <bdi dir="ltr">{details}</bdi>
        </p>
      ) : null}
    </div>
  );
}

export function PackageSaleResult({
  status,
  timedOut,
  recheck,
  error,
}: {
  status: PackageSaleStatus | undefined;
  timedOut: boolean;
  recheck: () => void;
  error?: unknown;
}) {
  const locale = useLocale();
  if (error)
    return (
      <div role="alert" className="grid gap-2 text-start">
        <p>{envelopeMessage(error, locale)}</p>
        <Button type="button" variant="outline" onClick={recheck}>
          {t(locale, 'packageSale.recheck')}
        </Button>
      </div>
    );
  if (!status || status.status === 'pending')
    return (
      <div role="status" className="grid gap-2 text-start">
        <p>{t(locale, timedOut ? 'packageSale.timeout' : 'packageSale.pending')}</p>
        {timedOut ? (
          <Button type="button" variant="outline" onClick={recheck}>
            {t(locale, 'packageSale.recheck')}
          </Button>
        ) : null}
      </div>
    );
  if (status.status === 'failed') return packageSaleFailure(status.error, locale);
  const entitlement = status.entitlement;
  return (
    <Card role="status" className="grid gap-2 p-4 text-start">
      <h2>{t(locale, 'packageSale.completed')}</h2>
      <p>{locale === 'ar' ? (entitlement.name_ar ?? entitlement.name_en) : entitlement.name_en}</p>
      <p>
        {t(locale, 'packageSale.pricePaid')}{' '}
        <bdi dir="ltr">{formatKwd(parseMoney(entitlement.price_paid))}</bdi>
      </p>
      <p>
        {t(locale, 'packageSale.discount')}{' '}
        <bdi dir="ltr">{formatKwd(parseMoney(entitlement.discount))}</bdi>
      </p>
      <p>
        {t(locale, 'packageSale.expiresOn')} <bdi dir="ltr">{entitlement.expires_on}</bdi>
      </p>
    </Card>
  );
}
