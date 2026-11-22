'use client';
import type { WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useCreatePackageType } from '../api/use-package-types';
import { PackageTypeForm } from '../ui/package-type-form';

export function CreatePackageTypePage({
  companyId,
  business,
  userId,
}: {
  companyId: string;
  business: WorkspaceBusinessRead;
  userId: string;
}) {
  const locale = useLocale();
  const save = useCreatePackageType(companyId, business.id, userId);
  return (
    <PageShell layout="form">
      <PageHeader title={t(locale, 'catalogPackageTypes.title')} />
      <PackageTypeForm
        key={save.data?.id ?? 'new'}
        companyId={companyId}
        businessId={business.id}
        userId={userId}
        pending={save.isPending}
        onSave={(terms) => save.mutate(terms)}
      />
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      {save.isSuccess ? (
        <p role="status">
          {t(locale, 'catalogPackageTypes.created')}{' '}
          {locale === 'ar' ? (save.data.name_ar ?? save.data.name_en) : save.data.name_en}
        </p>
      ) : null}
    </PageShell>
  );
}
