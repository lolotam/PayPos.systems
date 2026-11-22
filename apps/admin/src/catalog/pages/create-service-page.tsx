'use client';
import type { WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useOpenServiceCategories } from '../api/use-service-categories';
import { useCreateService } from '../api/use-services';
import { ServiceForm } from '../ui/service-form';

export function CreateServicePage({
  companyId,
  business,
  userId,
}: {
  companyId: string;
  business: WorkspaceBusinessRead;
  userId: string;
}) {
  const locale = useLocale();
  const save = useCreateService(companyId, business.id, userId);
  const categoryQuery = useOpenServiceCategories(companyId, business.id, userId);
  return (
    <PageShell layout="form">
      <PageHeader title={t(locale, 'catalogServices.title')} />
      <ServiceForm
        categoryQuery={categoryQuery}
        pending={save.isPending}
        onSave={(terms) => save.mutate(terms)}
      />
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      {save.isSuccess ? (
        <p role="status">
          {t(locale, 'catalogServices.created')}{' '}
          {locale === 'ar' ? (save.data.name_ar ?? save.data.name_en) : save.data.name_en}
        </p>
      ) : null}
    </PageShell>
  );
}
