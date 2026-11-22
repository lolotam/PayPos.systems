'use client';
import type { PackageTypePage } from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { ListQueryStates } from './list-query-states';
import { PackageTypesPageNavigation } from './package-types-page-navigation';
import { PackageTypesTable } from './package-types-table';

export function PackageTypesListPanel({
  list,
  companyId,
  businessId,
  userId,
  selectedId,
  cursor,
  onSelect,
  onPage,
}: {
  list: UseQueryResult<PackageTypePage>;
  companyId: string;
  businessId: string;
  userId: string;
  selectedId: string;
  cursor: string | undefined;
  onSelect: (id: string) => void;
  onPage: (cursor: string | undefined) => void;
}) {
  const locale = useLocale();
  return (
    <DataTableFrame
      stacked
      title={t(locale, 'catalogPackageTypes.listTitle')}
      footer={
        list.isSuccess ? (
          <PackageTypesPageNavigation
            cursor={cursor}
            next={list.data.next_cursor}
            onChange={onPage}
          />
        ) : undefined
      }
    >
      <ListQueryStates list={list} emptyTitle={t(locale, 'catalogPackageTypes.empty')}>
        {(data) => (
          <PackageTypesTable
            items={data.items}
            canManage={data.can_manage}
            companyId={companyId}
            businessId={businessId}
            userId={userId}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        )}
      </ListQueryStates>
    </DataTableFrame>
  );
}
