'use client';
import type { EmployeeNumberPage } from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState, LoaderCircle, UserRound } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeePageNavigation } from '../../ui/employee-page-navigation';
import { companyNumbersListDenied } from '../model/company-employee-number-message';
import { CompanyEmployeeNumbersTable } from './company-employee-numbers-table';

type CompanyEmployeeNumbersPanelProps = {
  list: UseQueryResult<EmployeeNumberPage>;
  cursor: string | undefined;
  editingId: string | undefined;
  pending: boolean;
  message: string | null;
  onEdit: (employeeId: string) => void;
  onClose: () => void;
  onPage: (cursor: string | undefined) => void;
  onSubmit: (employeeNumber: number) => void;
};

export function CompanyEmployeeNumbersPanel({
  list,
  cursor,
  editingId,
  pending,
  message,
  onEdit,
  onClose,
  onPage,
  onSubmit,
}: CompanyEmployeeNumbersPanelProps) {
  const locale = useLocale();
  if (list.isPending) {
    return <EmptyState role="status" icon={<LoaderCircle />} title={t(locale, 'admin.loading')} />;
  }
  if (companyNumbersListDenied(list.error)) {
    return (
      <EmptyState
        role="alert"
        tone="danger"
        icon={<CircleAlert />}
        title={t(locale, 'companyEmployeeNumbers.noAccess')}
      />
    );
  }
  if (list.isError || !list.data) {
    return (
      <EmptyState
        role="alert"
        tone="danger"
        icon={<CircleAlert />}
        title={envelopeMessage(list.error, locale)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {list.data.items.length ? (
        <CompanyEmployeeNumbersTable
          items={list.data.items}
          editingId={editingId}
          pending={pending}
          message={message}
          onEdit={onEdit}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      ) : (
        <EmptyState icon={<UserRound />} title={t(locale, 'companyEmployeeNumbers.empty')} />
      )}
      <EmployeePageNavigation cursor={cursor} next={list.data.next_cursor} onChange={onPage} />
    </div>
  );
}
