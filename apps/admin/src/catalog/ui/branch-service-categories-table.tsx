'use client';
import type {
  ServiceCategoryBranchListItem,
  ServiceCategoryBranchPage,
  ServiceCategoryBranchSettingState,
  ServiceCategoryBranchView,
} from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { t, type Locale } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { BranchServiceCategoriesGrid } from './branch-service-categories-grid';
import { ListQueryStates } from './list-query-states';
import { ServicesPageNavigation } from './services-page-navigation';

const columns = (locale: Locale) => [
  { id: 'name', header: t(locale, 'catalogServiceCategories.listTitle') },
  { id: 'visibility', header: t(locale, 'catalogServiceCategories.visibility') },
  { id: 'marks', header: t(locale, 'catalogServiceCategoryBranches.branchColumn') },
  {
    id: 'actions',
    // الترويسة كانت فارغة؛ النص مخفي بصريًا فيبقى سطح الجدول كما هو ويكتسب العمود اسمًا لقارئ الشاشة.
    header: () => (
      <span className="sr-only">{t(locale, 'attendanceActions.actions')}</span>
    ),
  },
];

export function BranchServiceCategoriesTable({
  list,
  filter,
  branchId,
  view,
  pending,
  cursor,
  onPage,
  onState,
  onManage,
}: {
  list: UseQueryResult<ServiceCategoryBranchPage>;
  /** تبويبات العرض داخل كرت القائمة فوق الجدول، وتبقى ظاهرة أثناء التحميل والخطأ والفراغ. */
  filter: ReactNode;
  branchId: string;
  view: ServiceCategoryBranchView;
  pending: boolean;
  cursor: string | undefined;
  onPage: (cursor: string | undefined) => void;
  onState: (item: ServiceCategoryBranchListItem, state: ServiceCategoryBranchSettingState) => void;
  onManage: (categoryId: string) => void;
}) {
  'use no memo';
  const locale = useLocale();
  const data = useMemo(() => [...(list.data?.items ?? [])], [list.data]);
  const table = useReactTable({
    data,
    columns: columns(locale),
    getRowId: (item) => item.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  return (
    <DataTableFrame
      stacked
      title={t(locale, 'catalogServiceCategories.listTitle')}
      filters={filter}
      footer={
        list.isSuccess ? (
          <ServicesPageNavigation cursor={cursor} next={list.data.next_cursor} onChange={onPage} />
        ) : undefined
      }
    >
      <ListQueryStates list={list} emptyTitle={t(locale, 'catalogServiceCategories.empty')}>
        {() => (
          <BranchServiceCategoriesGrid
            table={table}
            branchId={branchId}
            view={view}
            pending={pending}
            onState={onState}
            onManage={onManage}
          />
        )}
      </ListQueryStates>
    </DataTableFrame>
  );
}
