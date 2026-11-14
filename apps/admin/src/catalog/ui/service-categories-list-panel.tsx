'use client';
import type { ServiceCategoryClosingAction, ServiceCategoryPage } from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState, LoaderCircle, Store } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { ServiceCategoriesTable } from './service-categories-table';
import { ServicesPageNavigation } from './services-page-navigation';

export function ServiceCategoriesListPanel({
  list,
  selectedId,
  cursor,
  tracked,
  onSelect,
  onPage,
}: {
  list: UseQueryResult<ServiceCategoryPage>;
  selectedId: string;
  cursor: string | undefined;
  tracked: { categoryId: string; action: ServiceCategoryClosingAction } | null;
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
        <ServiceCategoriesTable
          items={list.data.items}
          selectedId={selectedId}
          tracked={tracked}
          onSelect={onSelect}
        />
      ) : (
        <EmptyState icon={<Store />} title={t(locale, 'catalogServiceCategories.empty')} />
      )}
      <ServicesPageNavigation cursor={cursor} next={list.data.next_cursor} onChange={onPage} />
    </div>
  );
}
