'use client';
import type { SellablePackageType } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import type { usePackageSaleTypeOptions } from './package-sale-type-option';

export function PackageSaleTypeField({
  picker,
  onReconfirm,
  disabled,
}: {
  picker: ReturnType<typeof usePackageSaleTypeOptions>;
  onReconfirm: (type: SellablePackageType) => void;
  disabled: boolean;
}) {
  const { locale, query, options, refreshed, quoteChanged } = picker;
  return (
    <fieldset disabled={disabled} className="grid gap-3 text-start">
      <legend>{t(locale, 'packageSale.packageType')}</legend>
      <div
        role="radiogroup"
        aria-label={t(locale, 'packageSale.packageType')}
        className="grid gap-2"
      >
        {options}
      </div>
      {quoteChanged && refreshed ? (
        <Button type="button" variant="outline" onClick={() => onReconfirm(refreshed)}>
          {t(locale, 'packageSale.confirmRefreshedQuote')}
        </Button>
      ) : null}
      {query.isLoading ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {query.isError ? (
        <>
          <p role="alert">{envelopeMessage(query.error, locale)}</p>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            {t(locale, 'packageSale.retryTypes')}
          </Button>
        </>
      ) : null}
      {query.data && query.data.items.length === 0 ? (
        <p role="status">{t(locale, 'packageSale.emptyTypes')}</p>
      ) : null}
      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {t(locale, 'packageSale.moreTypes')}
        </Button>
      ) : null}
    </fieldset>
  );
}
