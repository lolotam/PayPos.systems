'use client';
import type { EmployeeNumberPage } from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { DataTableFrame, EmptyState, LoaderCircle, UserRound } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeePageNavigation } from '../../ui/employee-page-navigation';
import { CompanyEmployeeNumbersError } from './company-employee-numbers-error';
import { CompanyEmployeeNumbersTable } from './company-employee-numbers-table';

type CompanyEmployeeNumbersPanelProps = {
  list: UseQueryResult<EmployeeNumberPage>;
  /** شريط البحث داخل كرت القائمة فوق الجدول؛ يغيب فقط عند رفض الصلاحية. */
  filter: ReactNode;
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
  filter,
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
  const data = list.isPending || list.isError ? undefined : list.data;
  return (
    <DataTableFrame
      stacked
      title={t(locale, 'companyEmployeeNumbers.title')}
      filters={filter}
      footer={
        data ? (
          <EmployeePageNavigation
            cursor={cursor}
            next={data.next_cursor}
            onChange={onPage}
            disabled={pending}
          />
        ) : undefined
      }
    >
      {list.isPending ? (
        <EmptyState role="status" icon={<LoaderCircle />} title={t(locale, 'admin.loading')} />
      ) : null}
      {list.isError ? <CompanyEmployeeNumbersError error={list.error} /> : null}
      {data && data.items.length === 0 ? (
        <EmptyState icon={<UserRound />} title={t(locale, 'companyEmployeeNumbers.empty')} />
      ) : null}
      {data && data.items.length > 0 ? (
        <CompanyEmployeeNumbersTable
          items={data.items}
          editingId={editingId}
          pending={pending}
          message={message}
          onEdit={onEdit}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      ) : null}
    </DataTableFrame>
  );
}
