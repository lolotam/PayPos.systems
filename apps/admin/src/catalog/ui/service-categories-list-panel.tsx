'use client';
import type { ServiceCategoryPage } from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { CircleAlert, DataTableFrame, EmptyState, LoaderCircle, Store } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
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
        <EmptyState icon={<Store />} title={t(locale, 'catalogServiceCategories.empty')} />
      ) : null}
      {list.isSuccess && list.data.items.length > 0 ? (
        <ServiceCategoriesTable
          items={list.data.items}
          selectedId={selectedId}
          tracked={tracked}
          onSelect={onSelect}
        />
      ) : null}
    </DataTableFrame>
  );
}
