'use client';

import { t } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useBusinessDiscountDefault } from '../api/use-business-discount-default';
import { DiscountLimitForm } from './discount-limit-form';

export function BusinessDiscountDefault({
  companyId,
  userId,
  businessId,
  businessName,
}: {
  companyId: string;
  userId: string;
  businessId: string;
  businessName: string;
}) {
  const locale = useLocale();
  const { query, mutation } = useBusinessDiscountDefault(companyId, userId, businessId);
  return (
    <section
      className="flex flex-col gap-2 text-start"
      aria-label={t(locale, 'permissions.businessDiscountTitle')}
    >
      <h2 className="text-lg font-semibold">
        {t(locale, 'permissions.businessDiscountTitle')} · {businessName}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t(locale, 'permissions.businessDiscountLead')}
      </p>
      {query.isPending ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {query.isError ? <p role="alert">{envelopeMessage(query.error, locale)}</p> : null}
      {query.data ? (
        <DiscountLimitForm
          key={`${businessId}:${query.data.limit_bps}`}
          limitBps={query.data.limit_bps}
          disabled={false}
          pending={mutation.isPending}
          label={t(locale, 'permissions.businessDiscountLabel')}
          unsetText={t(locale, 'permissions.businessDiscountUnset')}
          onSave={(input) => mutation.mutate(input)}
        />
      ) : null}
      {mutation.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {envelopeMessage(mutation.error, locale)}
        </p>
      ) : null}
      {mutation.isSuccess ? (
        <p role="status" className="text-sm text-success">
          {t(locale, 'permissions.discountSaved')}
        </p>
      ) : null}
    </section>
  );
}
