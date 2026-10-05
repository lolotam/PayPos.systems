'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Card, EmptyState, CircleAlert, LoaderCircle } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeEdit } from '../api/use-employees';
import { EditEmployeeForm } from './edit-employee-form';
import { EmployeeRecordSections } from './employee-record-sections';
import { EmployeeEditActions } from './employee-edit-actions';
import { EmployeeLeaveSection } from './employee-leave-section';

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
      {/* TODO(spec) SS-Q2: الوصول هنا يتطلب manage:employees:business؛ مدخل مستقل لمفوّض الرواتب ينتظر قرار المالك. */}
      {record.data && !record.isError ? (
        <EmployeeRecordSections {...{ companyId, businessId: business.id, userId, employeeId }} />
      ) : null}
      <EmployeeEditActions
        pending={save.isPending}
        fetching={record.isFetching}
        onReload={() => {
          save.reset();
          void record.refetch();
        }}
        onClose={onClose}
      />
      <EmployeeLeaveSection
        {...{ companyId, businessId: business.id, userId, employeeId }}
        branches={business.branches}
      />
    </Card>
  );
}
