'use client';
import type { PackageTypePage } from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { CircleAlert, DataTableFrame, EmptyState, LoaderCircle, Store } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
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
      {list.isSuccess && list.data.items.length === 0 ? (
        <EmptyState icon={<Store />} title={t(locale, 'catalogPackageTypes.empty')} />
      ) : null}
      {list.isSuccess && list.data.items.length > 0 ? (
        <PackageTypesTable
          items={list.data.items}
          canManage={list.data.can_manage}
          companyId={companyId}
          businessId={businessId}
          userId={userId}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ) : null}
    </DataTableFrame>
  );
}
