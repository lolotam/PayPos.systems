'use client';
import { t } from '@pospay/i18n';
import { AppSidebarItem, Store } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/shared/locale/locale-context';

/** مدخلا الخدمات وأنواع الباقات، مع تمييز المدخل المطابق للمسار الحالي فقط. */
export function CatalogNavItem() {
  const locale = useLocale();
  const pathname = usePathname();
  return (
    <>
      <AppSidebarItem
        asChild
        icon={<Store />}
        label={t(locale, 'catalogServices.listTitle')}
        active={pathname.startsWith('/catalog') && !pathname.startsWith('/catalog/package-types')}
      >
        <Link href="/catalog" />
      </AppSidebarItem>
      <AppSidebarItem
        asChild
        icon={<Store />}
        label={t(locale, 'catalogPackageTypes.listTitle')}
        active={pathname.startsWith('/catalog/package-types')}
      >
        <Link href="/catalog/package-types" />
      </AppSidebarItem>
    </>
  );
}
