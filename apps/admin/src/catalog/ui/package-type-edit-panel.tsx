'use client';
import { t } from '@pospay/i18n';
import { Button, Card, CircleAlert, EmptyState, LoaderCircle } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { usePackageTypeEdit } from '../api/use-package-types';
import { EditPackageTypeForm } from './edit-package-type-form';

export function PackageTypeEditPanel({
  companyId,
  businessId,
  userId,
  packageTypeId,
  onClose,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  packageTypeId: string;
  onClose: () => void;
}) {
  const locale = useLocale();
  const { record, save } = usePackageTypeEdit(companyId, businessId, userId, packageTypeId);
  return (
    <Card className="flex max-w-xl flex-col gap-4 p-6">
      <h2 className="text-xl font-bold">{t(locale, 'catalogPackageTypes.editTitle')}</h2>
      {record.isPending ? (
        <EmptyState icon={<LoaderCircle />} role="status" title={t(locale, 'admin.loading')} />
      ) : null}
      {record.isError ? (
        <EmptyState
          icon={<CircleAlert />}
          role="alert"
          tone="danger"
          title={envelopeMessage(record.error, locale)}
        />
      ) : null}
      {record.data && !record.isError ? (
        <EditPackageTypeForm
          key={`${record.data.id}:${record.data.revision}`}
          companyId={companyId}
          businessId={businessId}
          userId={userId}
          record={record.data}
          pending={save.isPending}
          onSave={(terms) => save.mutate(terms)}
        />
      ) : null}
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      {save.isSuccess ? <p role="status">{t(locale, 'catalogPackageTypes.saved')}</p> : null}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={save.isPending}
          onClick={() => {
            save.reset();
            void record.refetch();
          }}
        >
          {t(locale, 'catalogPackageTypes.reload')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t(locale, 'catalogPackageTypes.cancel')}
        </Button>
      </div>
    </Card>
  );
}
