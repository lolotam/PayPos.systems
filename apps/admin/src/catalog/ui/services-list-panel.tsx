'use client';
import type { ServicePage } from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { CircleAlert, DataTableFrame, EmptyState, LoaderCircle, Store } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { ServicesPageNavigation } from './services-page-navigation';
import { ServicesTable } from './services-table';

export function ServicesListPanel({
  list,
  filter,
  selectedId,
  cursor,
  onSelect,
  onPage,
}: {
  list: UseQueryResult<ServicePage>;
  /** شريط التصفية يُعرض داخل كرت القائمة فوق الجدول، ويبقى ظاهرًا أثناء التحميل والخطأ والفراغ. */
  filter: ReactNode;
  selectedId: string;
  cursor: string | undefined;
  onSelect: (id: string) => void;
  onPage: (cursor: string | undefined) => void;
}) {
  const locale = useLocale();
  return (
    <DataTableFrame
      stacked
      title={t(locale, 'catalogServices.listTitle')}
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
        <EmptyState icon={<Store />} title={t(locale, 'catalogServices.empty')} />
      ) : null}
      {list.isSuccess && list.data.items.length > 0 ? (
        <ServicesTable items={list.data.items} selectedId={selectedId} onSelect={onSelect} />
      ) : null}
    </DataTableFrame>
  );
}
