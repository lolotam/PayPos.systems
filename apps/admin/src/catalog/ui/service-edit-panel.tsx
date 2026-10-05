'use client';
import { t } from '@pospay/i18n';
import { Button, Card, CircleAlert, EmptyState, LoaderCircle } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useServiceEdit } from '../api/use-services';
import { EditServiceForm } from './edit-service-form';

export function ServiceEditPanel({
  companyId,
  businessId,
  userId,
  serviceId,
  onClose,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  serviceId: string;
  onClose: () => void;
}) {
  const locale = useLocale();
  const { record, save } = useServiceEdit(companyId, businessId, userId, serviceId);
  return (
    <Card className="flex max-w-xl flex-col gap-4 p-6">
      <h2 className="text-xl font-bold">{t(locale, 'catalogServices.editTitle')}</h2>
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
        <EditServiceForm
          key={`${record.data.id}:${record.data.revision}`}
          record={record.data}
          pending={save.isPending}
          onSave={(terms) => save.mutate(terms)}
        />
      ) : null}
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      {save.isSuccess ? <p role="status">{t(locale, 'catalogServices.saved')}</p> : null}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={save.isPending}
          onClick={() => {
            save.reset();
            void record.refetch();
          }}
        >
          {t(locale, 'catalogServices.reload')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t(locale, 'catalogServices.cancel')}
        </Button>
      </div>
    </Card>
  );
}
