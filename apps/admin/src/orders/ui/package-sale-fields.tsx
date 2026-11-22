'use client';
import type { PackagePaidMethod } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { packageSaleScopeKey, usePackageSaleSellers } from '../api/use-package-sale-context';
import type { SessionServiceScope } from '../api/use-session-services';

export type PackageSaleFieldValues = {
  price_paid: string;
  paid_method: PackagePaidMethod;
  seller_employee_id: string;
};

// كل حقل (تسمية وعنصر تحكم ورسالته) وحدة واحدة على شبكة الـ12 عمودًا: الحقول القصيرة 4 أعمدة، وتتكدس على الهاتف.
const SHORT_CELL = 'col-span-12 flex min-w-0 flex-col gap-3 md:col-span-4';

function packageSaleSellerFailure(
  query: ReturnType<typeof usePackageSaleSellers>,
  locale: 'ar' | 'en',
) {
  const failure = query.isError ? query.error : query.context.isError ? query.context.error : null;
  if (!failure) return null;
  return (
    <>
      <p role="alert">{envelopeMessage(failure, locale)}</p>
      <Button type="button" variant="outline" onClick={query.retry}>
        {t(locale, 'packageSale.retrySellers')}
      </Button>
    </>
  );
}

type SellerQuery = ReturnType<typeof usePackageSaleSellers>;
type SellerOption = NonNullable<SellerQuery['data']>['pages'][number]['items'][number];

function sellerVerification(query: SellerQuery, selected: string) {
  const selectedOption = query.data?.pages
    .flatMap((page) => page.items)
    .find((item) => item.id === selected);
  const readable =
    query.data !== undefined &&
    !query.isPlaceholderData &&
    !query.isError &&
    !query.context.isFetching &&
    !query.context.isError;
  return {
    selectedOption,
    verified: Boolean(selected && selectedOption && readable),
    absent: Boolean(
      selected && !selectedOption && readable && !query.isFetching && !query.hasNextPage,
    ),
  };
}

function usePackageSaleSellerVerification(
  query: SellerQuery,
  form: UseFormReturn<PackageSaleFieldValues>,
  locale: 'ar' | 'en',
  scopeKey: string,
) {
  const selected = form.watch('seller_employee_id');
  const status = sellerVerification(query, selected);
  useLayoutEffect(() => {
    if (!selected || status.verified) {
      if (status.verified) form.clearErrors('seller_employee_id');
      return;
    }
    if (status.absent) form.setValue('seller_employee_id', '');
    form.setError('seller_employee_id', { message: t(locale, 'packageSale.reconfirmSeller') });
  }, [form, locale, selected, status.absent, status.verified]);
  useLayoutEffect(() => {
    form.setValue('seller_employee_id', '');
    form.clearErrors('seller_employee_id');
  }, [form, scopeKey]);
  return status;
}

function cachedSellerOption(
  client: QueryClient,
  scope: SessionServiceScope,
  locale: 'ar' | 'en',
  selected: string,
  current: SellerOption | undefined,
) {
  if (current) return current;
  return client
    .getQueriesData<NonNullable<SellerQuery['data']>>({
      queryKey: ['package-sale-sellers', ...packageSaleScopeKey(scope), locale],
    })
    .flatMap(([, data]) => data?.pages.flatMap((page) => page.items) ?? [])
    .find((item) => item.id === selected);
}

function usePackageSaleSellerField(
  scope: SessionServiceScope,
  disabled: boolean,
  form: UseFormReturn<PackageSaleFieldValues>,
) {
  const locale = useLocale();
  const selected = form.watch('seller_employee_id');
  const scopeKey = packageSaleScopeKey(scope).join('/');
  const query = usePackageSaleSellers(scope, !disabled, selected);
  const status = usePackageSaleSellerVerification(query, form, locale, scopeKey);
  const client = useQueryClient();
  const performers = query.data?.pages.flatMap((page) => page.items) ?? [];
  const previousOption = cachedSellerOption(client, scope, locale, selected, status.selectedOption);
  if (previousOption && !performers.some((item) => item.id === selected)) {
    performers.push(previousOption);
  }
  const registration = form.register('seller_employee_id', {
    validate: (value) => !value || status.verified || t(locale, 'packageSale.reconfirmSeller'),
  });
  return (
    <>
      <Label htmlFor="package-sale-seller">{t(locale, 'packageSale.seller')}</Label>
      <NativeSelect
        id="package-sale-seller"
        {...registration}
        onChange={(event) => {
          void registration.onChange(event);
          form.clearErrors('seller_employee_id');
        }}
      >
        <option value="">{t(locale, 'packageSale.chooseSeller')}</option>
        {performers.map((performer) => (
          <option key={performer.id} value={performer.id}>
            {locale === 'ar' ? (performer.name_ar ?? performer.name_en) : performer.name_en}
          </option>
        ))}
      </NativeSelect>
      {form.formState.errors.seller_employee_id ? (
        <p role="alert">{form.formState.errors.seller_employee_id.message}</p>
      ) : null}
      {query.isLoading || query.context.isLoading ? (
        <p role="status">{t(locale, 'admin.loading')}</p>
      ) : null}
      {packageSaleSellerFailure(query, locale)}
      {query.data && performers.length === 0 ? (
        <p role="status">{t(locale, 'packageSale.emptySellers')}</p>
      ) : null}
      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {t(locale, 'packageSale.moreSellers')}
        </Button>
      ) : null}
    </>
  );
}

export function PackageSaleFields({
  scope,
  form,
  disabled,
}: {
  scope: SessionServiceScope;
  form: UseFormReturn<PackageSaleFieldValues>;
  disabled: boolean;
}) {
  const locale = useLocale();
  const sellers = usePackageSaleSellerField(scope, disabled, form);
  return (
    <fieldset disabled={disabled} className="grid grid-cols-12 gap-4 text-start">
      <div className={SHORT_CELL}>
        <Label htmlFor="package-sale-price">{t(locale, 'packageSale.pricePaid')}</Label>
        <Input
          id="package-sale-price"
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          {...form.register('price_paid')}
        />
      </div>
      <div className={SHORT_CELL}>
        <Label htmlFor="package-sale-method">{t(locale, 'packageSale.paymentMethod')}</Label>
        <NativeSelect id="package-sale-method" {...form.register('paid_method')}>
          <option value="CASH">{t(locale, 'packageSale.cash')}</option>
          <option value="CARD">{t(locale, 'packageSale.card')}</option>
        </NativeSelect>
      </div>
      <div className={SHORT_CELL}>{sellers}</div>
    </fieldset>
  );
}
