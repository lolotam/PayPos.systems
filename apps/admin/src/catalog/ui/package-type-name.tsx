'use client';
import type { PackageTypeListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

export function PackageTypeName({ item }: { item: PackageTypeListItem }) {
  const locale = useLocale();
  return (
    <>
      {locale === 'ar' ? (item.name_ar ?? item.name_en) : item.name_en}
      {item.selling_stopped_at !== null ? (
        <span className="ms-2 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground">
          {t(locale, 'catalogPackageTypes.notOnSale')}
        </span>
      ) : null}
    </>
  );
}
