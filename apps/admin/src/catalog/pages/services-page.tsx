'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useServices } from '../api/use-services';
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
  const list = useServices(companyId, business.id, userId, cursor);
  const page = (next: string | undefined) => {
    setCursor(next);
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
