'use client';
import { t } from '@pospay/i18n';
import { Card, CircleAlert, EmptyState, LoaderCircle } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useOpenServiceCategories } from '../api/use-service-categories';
import { useServiceClosing } from '../api/use-service-closing';
import { useServiceEdit } from '../api/use-services';
import { ServiceEditActions } from './service-edit-actions';
import { ServiceEditRecord } from './service-edit-record';

type ServiceEditPanelProps = {
  companyId: string;
  businessId: string;
  userId: string;
  serviceId: string;
  onClose: () => void;
};

export function ServiceEditPanel(props: ServiceEditPanelProps) {
  const { companyId, businessId, userId, serviceId, onClose } = props;
  const locale = useLocale();
  const { record, save } = useServiceEdit(companyId, businessId, userId, serviceId);
  const closing = useServiceClosing(companyId, businessId, userId, serviceId);
  const categoryQuery = useOpenServiceCategories(companyId, businessId, userId);
  // أياً من الحفظ أو القفل أو إعادة التحميل يبدأ بيمسح نتايج الاتنين عشان مساحة النتيجة الواحدة
  // ما تعرضش سطرين مع بعض.
  const clearOutcome = () => {
    save.reset();
    closing.reset();
  };
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
        <ServiceEditRecord
          record={record.data}
          categoryQuery={categoryQuery}
          save={save}
          closing={closing}
          onSave={(terms) => {
            clearOutcome();
            save.mutate(terms);
          }}
          onRequestClosing={(input) => {
            clearOutcome();
            closing.mutate(input);
          }}
        />
      ) : null}
      <ServiceEditActions
        pending={save.isPending || closing.isPending}
        onReload={() => {
          clearOutcome();
          void record.refetch();
        }}
        onClose={onClose}
      />
    </Card>
  );
}
