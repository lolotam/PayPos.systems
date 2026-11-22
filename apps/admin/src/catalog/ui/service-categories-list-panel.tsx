'use client';
import type { ServiceCategoryPage } from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { ListQueryStates } from './list-query-states';
import type { TrackedServiceCategoryClosing } from '../model/service-category-closing';
import { ServiceCategoriesTable } from './service-categories-table';
import { ServicesPageNavigation } from './services-page-navigation';

export function ServiceCategoriesListPanel({
  list,
  filter,
  selectedId,
  cursor,
  tracked,
  onSelect,
  onPage,
}: {
  list: UseQueryResult<ServiceCategoryPage>;
  /** تبويبات الحالة داخل كرت القائمة فوق الجدول، وتبقى ظاهرة أثناء التحميل والخطأ والفراغ. */
  filter: ReactNode;
  selectedId: string;
  cursor: string | undefined;
  tracked: Readonly<Record<string, Pick<TrackedServiceCategoryClosing, 'action'>>>;
  onSelect: (id: string) => void;
  onPage: (cursor: string | undefined) => void;
}) {
  const locale = useLocale();
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
        {(data) => (
          <ServiceCategoriesTable
            items={data.items}
            selectedId={selectedId}
            tracked={tracked}
            onSelect={onSelect}
          />
        )}
      </ListQueryStates>
    </DataTableFrame>
  );
}
