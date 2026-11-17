'use client';
import type { ServiceCategoryPage } from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { TrackedServiceCategoryClosing } from '../model/service-category-closing';
import { ServiceCategoriesListPanel } from './service-categories-list-panel';
import { ServiceCategoryStatusTabs } from './service-category-status-tabs';

export function ServiceCategoryPageControls({
  status,
  onCreate,
  onStatus,
  list,
  selectedId,
  cursor,
  tracked,
  onSelect,
  onPage,
}: {
  status: 'open' | 'closed' | 'all';
  onCreate: () => void;
  onStatus: (status: 'open' | 'closed' | 'all') => void;
  list: UseQueryResult<ServiceCategoryPage>;
  selectedId: string;
  cursor: string | undefined;
  tracked: Readonly<Record<string, Pick<TrackedServiceCategoryClosing, 'action'>>>;
  onSelect: (id: string) => void;
  onPage: (cursor: string | undefined) => void;
}) {
  const locale = useLocale();
  return (
    <>
      <PageHeader
        title={t(locale, 'catalogServiceCategories.listTitle')}
        description={t(locale, 'catalogServiceCategories.listLead')}
        action={<Button onClick={onCreate}>{t(locale, 'catalogServiceCategories.create')}</Button>}
      />
      <ServiceCategoryStatusTabs value={status} onChange={onStatus} />
      <ServiceCategoriesListPanel
        list={list}
        selectedId={selectedId}
        cursor={cursor}
        tracked={tracked}
        onSelect={onSelect}
        onPage={onPage}
      />
    </>
  );
}
