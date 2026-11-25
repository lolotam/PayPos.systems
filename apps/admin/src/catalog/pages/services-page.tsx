'use client';
import type { WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader, PageShell } from '@pospay/ui';
import Link from 'next/link';
import { useLocale } from '@/shared/locale/locale-context';
import { useOpenServiceCategories } from '../api/use-service-categories';
import { useServices } from '../api/use-services';
import { ServiceCategoryFilter } from '../ui/service-category-filter';
import { ServiceEditPanel } from '../ui/service-edit-panel';
import { ServicesListPanel } from '../ui/services-list-panel';
import { useServicesPageState } from './services-page-state';

type ServicesPageProps = {
  companyId: string;
  business: WorkspaceBusinessRead;
  userId: string;
};

export function ServicesPage({ companyId, business, userId }: ServicesPageProps) {
  const locale = useLocale();
  const categoryQuery = useOpenServiceCategories(companyId, business.id, userId);
  const state = useServicesPageState(categoryQuery);
  const list = useServices(companyId, business.id, userId, {
    cursor: state.cursor,
    categoryId: state.activeCategoryId || undefined,
  });
  return (
    <PageShell layout="list">
      <PageHeader
        title={t(locale, 'catalogServices.listTitle')}
        description={t(locale, 'catalogServices.listLead')}
        actions={
          <Button asChild variant="outline">
            <Link href="/catalog/import">{t(locale, 'catalogServiceImport.importLink')}</Link>
          </Button>
        }
        action={
          <Button asChild>
            <Link href="/catalog/create">{t(locale, 'catalogServices.create')}</Link>
          </Button>
        }
      />
      <ServicesListPanel
        list={list}
        filter={
          <ServiceCategoryFilter
            categoryQuery={categoryQuery}
            value={state.activeCategoryId}
            onChange={state.filter}
          />
        }
        selectedId={state.serviceId}
        cursor={state.cursor}
        onSelect={state.setServiceId}
        onPage={state.page}
      />
      {state.serviceId ? (
        <ServiceEditPanel
          key={state.serviceId}
          companyId={companyId}
          businessId={business.id}
          userId={userId}
          serviceId={state.serviceId}
          onClose={() => state.setServiceId('')}
        />
      ) : null}
    </PageShell>
  );
}
