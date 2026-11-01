'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useOpenServiceCategories } from '../api/use-service-categories';
import { useServices } from '../api/use-services';
import { ServiceCategoryFilter } from '../ui/service-category-filter';
import { ServiceEditPanel } from '../ui/service-edit-panel';
import { ServicesListPanel } from '../ui/services-list-panel';

export function ServicesPage({
  companyId,
  business,
  userId,
}: {
  companyId: string;
  business: WorkspaceBusiness;
  userId: string;
}) {
  const locale = useLocale();
  const [cursor, setCursor] = useState<string>();
  const [serviceId, setServiceId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const categoryQuery = useOpenServiceCategories(companyId, business.id, userId);
  const list = useServices(companyId, business.id, userId, {
    cursor,
    categoryId: categoryId || undefined,
  });
  const page = (next: string | undefined) => {
    setCursor(next);
    setServiceId('');
  };
  const filter = (nextCategoryId: string) => {
    setCategoryId(nextCategoryId);
    setCursor(undefined);
    setServiceId('');
  };
  return (
    <section className="flex min-w-0 flex-col gap-8 text-start">
      <PageHeader
        title={t(locale, 'catalogServices.listTitle')}
        description={t(locale, 'catalogServices.listLead')}
        action={
          <Button asChild>
            <Link href="/catalog/create">{t(locale, 'catalogServices.create')}</Link>
          </Button>
        }
      />
      {categoryQuery.isError ? null : (
        <ServiceCategoryFilter
          categories={categoryQuery.data ?? []}
          value={categoryId}
          disabled={categoryQuery.isPending}
          onChange={filter}
        />
      )}
      <ServicesListPanel
        list={list}
        selectedId={serviceId}
        cursor={cursor}
        onSelect={setServiceId}
        onPage={page}
      />
      {serviceId ? (
        <ServiceEditPanel
          key={serviceId}
          companyId={companyId}
          businessId={business.id}
          userId={userId}
          serviceId={serviceId}
          onClose={() => setServiceId('')}
        />
      ) : null}
    </section>
  );
}
