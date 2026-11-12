'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Card, EmptyState, CircleAlert, LoaderCircle } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeEdit } from '../api/use-employees';
import { EditEmployeeForm } from './edit-employee-form';
import { EmployeeRecordSections } from './employee-record-sections';
import { EmployeeEditActions } from './employee-edit-actions';
import { EmployeeFileTabs, type EmployeeFileTab } from './employee-file-tabs';
import { EmployeeLeaveSection } from './employee-leave-section';
import { EmployeeProfileHeading } from './employee-profile-heading';

type EmployeeEditPanelProps = {
  companyId: string;
  business: WorkspaceBusiness;
  userId: string;
  employeeId: string;
  onClose: () => void;
};
type EditState = ReturnType<typeof useEmployeeEdit>;
type DataTabProps = {
  companyId: string;
  business: WorkspaceBusiness;
  userId: string;
  record: EditState['record'];
  save: EditState['save'];
  locale: Locale;
  hidden: boolean;
};

function dataTabContent({
  companyId,
  business,
  userId,
  record,
  save,
  locale,
  hidden,
}: DataTabProps) {
  return (
    <div hidden={hidden}>
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
          {...{ companyId, businessId: business.id, record: record.data }}
          key={`${record.data.id}:${record.data.revision}`}
          branches={business.branches}
          pending={save.isPending}
          onSave={(terms) => save.mutate(terms)}
        />
      ) : null}
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      {save.isSuccess ? <p role="status">{t(locale, 'staff.saved')}</p> : null}
      {/* TODO(spec) SS-Q2: الوصول هنا يتطلب manage:employees:business؛ مدخل مستقل لمفوّض الرواتب ينتظر قرار المالك. */}
      {record.data && !record.isError ? (
        <EmployeeRecordSections {...recordSectionProps(companyId, business, userId, record.data)} />
      ) : null}
    </div>
  );
}

export function EmployeeEditPanel({
  companyId,
  business,
  userId,
  employeeId,
  onClose,
}: EmployeeEditPanelProps) {
  const locale = useLocale();
  const [tab, setTab] = useState<EmployeeFileTab>('data');
  const { record, save } = useEmployeeEdit(companyId, business.id, userId, employeeId);
  return (
    <Card className="flex max-w-xl flex-col gap-4 p-6">
      <EmployeeProfileHeading
        companyId={companyId}
        businessId={business.id}
        userId={userId}
        employee={record.data && !record.isError ? record.data : undefined}
      />
      <EmployeeFileTabs value={tab} onChange={setTab} />
      {dataTabContent({
        companyId,
        business,
        userId,
        record,
        save,
        locale,
        hidden: tab !== 'data',
      })}
      {tab === 'leave' ? (
        <EmployeeLeaveSection
          {...{ companyId, businessId: business.id, userId, employeeId }}
          branches={business.branches}
          timeZone={
            business.branches.find((branch) => branch.id === record.data?.primary_branch_id)
              ?.effective_timezone
          }
        />
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
    </Card>
  );
}

function recordSectionProps(
  companyId: string,
  business: WorkspaceBusiness,
  userId: string,
  record: { id: string; primary_branch_id: string },
) {
  const branch = business.branches.find((b) => b.id === record.primary_branch_id);
  return {
    companyId,
    businessId: business.id,
    userId,
    employeeId: record.id,
    timeZone: branch?.effective_timezone,
  };
}
