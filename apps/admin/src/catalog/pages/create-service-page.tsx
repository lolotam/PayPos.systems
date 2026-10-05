'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useCreateService } from '../api/use-services';
import { ServiceForm } from '../ui/service-form';

export function CreateServicePage({
  companyId,
  business,
  userId,
}: {
  companyId: string;
  business: WorkspaceBusiness;
  userId: string;
}) {
  const locale = useLocale();
  const save = useCreateService(companyId, business.id, userId);
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 text-start">
      <h1 className="text-xl font-semibold">{t(locale, 'catalogServices.title')}</h1>
      <ServiceForm pending={save.isPending} onSave={(terms) => save.mutate(terms)} />
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      {save.isSuccess ? (
        <p role="status">
          {t(locale, 'catalogServices.created')}{' '}
          {locale === 'ar' ? (save.data.name_ar ?? save.data.name_en) : save.data.name_en}
        </p>
      ) : null}
    </section>
  );
}
