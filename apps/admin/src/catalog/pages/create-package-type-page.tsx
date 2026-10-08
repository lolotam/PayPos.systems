'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t } from '@pospay/i18n';
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
  business: WorkspaceBusiness;
  userId: string;
}) {
  const locale = useLocale();
  const save = useCreatePackageType(companyId, business.id, userId);
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 text-start">
      <h1 className="text-xl font-semibold">{t(locale, 'catalogPackageTypes.title')}</h1>
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
    </section>
  );
}
