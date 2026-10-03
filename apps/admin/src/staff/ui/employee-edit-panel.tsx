'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Card, EmptyState, CircleAlert, LoaderCircle } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeEdit } from '../api/use-employees';
import { EditEmployeeForm } from './edit-employee-form';

export function EmployeeEditPanel({
  companyId,
  business,
  userId,
  employeeId,
  onClose,
}: {
  companyId: string;
  business: WorkspaceBusiness;
  userId: string;
  employeeId: string;
  onClose: () => void;
}) {
  const locale = useLocale();
  const { record, save } = useEmployeeEdit(companyId, business.id, userId, employeeId);
  return (
    <Card className="flex max-w-xl flex-col gap-4 p-6">
      <h2 className="text-xl font-bold">{t(locale, 'staff.editTitle')}</h2>
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
        <EditEmployeeForm
          key={`${record.data.id}:${record.data.revision}`}
          record={record.data}
          branches={business.branches}
          pending={save.isPending}
          onSave={(terms) => save.mutate(terms)}
        />
      ) : null}
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      {save.isSuccess ? <p role="status">{t(locale, 'staff.saved')}</p> : null}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={save.isPending || record.isFetching}
          onClick={() => {
            save.reset();
            void record.refetch();
          }}
        >
          {t(locale, 'staff.reload')}
        </Button>
        <Button variant="outline" disabled={save.isPending} onClick={onClose}>
          {t(locale, 'staff.cancel')}
        </Button>
      </div>
    </Card>
  );
}
