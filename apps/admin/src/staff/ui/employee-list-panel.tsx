'use client';
import type { EmployeePage, WorkspaceBranch } from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { EmptyState, CircleAlert, LoaderCircle, UserRound } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeListSearch } from './employee-list-search';
import { EmployeeTable } from './employee-table';
import { EmployeePageNavigation } from './employee-page-navigation';

export function EmployeeListPanel({
  list,
  branches,
  selectedId,
  cursor,
  search,
  onSearch,
  onSelect,
  onPage,
}: {
  list: UseQueryResult<EmployeePage>;
  branches: readonly WorkspaceBranch[];
  selectedId: string;
  cursor: string | undefined;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onPage: (cursor: string | undefined) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-4">
      <EmployeeListSearch value={search} onChange={onSearch} />
      {list.isPending ? (
        <EmptyState role="status" icon={<LoaderCircle />} title={t(locale, 'admin.loading')} />
      ) : null}
      {list.isError ? (
        <EmptyState
          role="alert"
          tone="danger"
          icon={<CircleAlert />}
          title={envelopeMessage(list.error, locale)}
        />
      ) : null}
      {list.data && !list.isError ? (
        <>
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
          <EmployeePageNavigation
            cursor={cursor}
            next={list.data.next_cursor}
            stale={list.isPlaceholderData}
            onChange={onPage}
          />
        </>
      ) : null}
    </div>
  );
}
