'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { usePackageTypes } from '../api/use-package-types';
import { PackageTypeEditPanel } from '../ui/package-type-edit-panel';
import { PackageTypesListPanel } from '../ui/package-types-list-panel';

export function PackageTypesPage({
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
  const [packageTypeId, setPackageTypeId] = useState('');
  const list = usePackageTypes(companyId, business.id, userId, cursor);
  const page = (next: string | undefined) => {
    setCursor(next);
    setPackageTypeId('');
  };
  return (
    <section className="flex min-w-0 flex-col gap-8 text-start">
      <PageHeader
        title={t(locale, 'catalogPackageTypes.listTitle')}
        description={t(locale, 'catalogPackageTypes.listLead')}
        action={
          <Button asChild>
            <Link href="/catalog/package-types/create">
              {t(locale, 'catalogPackageTypes.create')}
            </Link>
          </Button>
        }
      />
      <PackageTypesListPanel
        list={list}
        selectedId={packageTypeId}
        cursor={cursor}
        onSelect={setPackageTypeId}
        onPage={page}
      />
      {packageTypeId ? (
        <PackageTypeEditPanel
          key={packageTypeId}
          companyId={companyId}
          businessId={business.id}
          userId={userId}
          packageTypeId={packageTypeId}
          onClose={() => setPackageTypeId('')}
        />
      ) : null}
    </section>
  );
}
