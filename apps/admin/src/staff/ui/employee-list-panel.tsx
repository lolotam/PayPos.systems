'use client';
import type { EmployeePage, WorkspaceBranch } from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { EmptyState, CircleAlert, LoaderCircle, UserRound } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeTable } from './employee-table';
import { EmployeePageNavigation } from './employee-page-navigation';

export function EmployeeListPanel({
  list,
  branches,
  selectedId,
  cursor,
  onSelect,
  onPage,
}: {
  list: UseQueryResult<EmployeePage>;
  branches: readonly WorkspaceBranch[];
  selectedId: string;
  cursor: string | undefined;
  onSelect: (id: string) => void;
  onPage: (cursor: string | undefined) => void;
}) {
  const locale = useLocale();
  if (list.isPending)
    return <EmptyState role="status" icon={<LoaderCircle />} title={t(locale, 'admin.loading')} />;
  if (list.isError)
    return (
      <EmptyState
        role="alert"
        tone="danger"
        icon={<CircleAlert />}
        title={envelopeMessage(list.error, locale)}
      />
    );
  return (
    <div className="flex flex-col gap-4">
      {list.data.items.length ? (
        <EmployeeTable
          items={list.data.items}
          branches={branches}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ) : (
        <EmptyState icon={<UserRound />} title={t(locale, 'staff.empty')} />
      )}
      <EmployeePageNavigation cursor={cursor} next={list.data.next_cursor} onChange={onPage} />
    </div>
  );
}
