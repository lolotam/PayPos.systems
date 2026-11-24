'use client';
import type { EmployeePage, WorkspaceBranch } from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { CircleAlert, DataTableFrame, EmptyState, LoaderCircle, UserRound } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeListSearch } from './employee-list-search';
import { EmployeeTable } from './employee-table';
import { EmployeePageNavigation } from './employee-page-navigation';

export function EmployeeListPanel({
  list,
  branches,
  cursor,
  search,
  onSearch,
  onPage,
}: {
  list: UseQueryResult<EmployeePage>;
  branches: readonly WorkspaceBranch[];
  cursor: string | undefined;
  search: string;
  onSearch: (value: string) => void;
  onPage: (cursor: string | undefined) => void;
}) {
  const locale = useLocale();
  const data = list.data && !list.isError ? list.data : undefined;
  return (
    <DataTableFrame
      stacked
      title={t(locale, 'staff.listTitle')}
      filters={<EmployeeListSearch value={search} onChange={onSearch} />}
      footer={
        data ? (
          <EmployeePageNavigation cursor={cursor} next={data.next_cursor} onChange={onPage} />
        ) : undefined
      }
    >
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
      {data && data.items.length === 0 ? (
        <EmptyState icon={<UserRound />} title={t(locale, 'staff.empty')} />
      ) : null}
      {data && data.items.length > 0 ? (
        <EmployeeTable items={data.items} branches={branches} />
      ) : null}
    </DataTableFrame>
  );
}
