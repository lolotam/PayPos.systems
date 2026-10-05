'use client';
import { t } from '@pospay/i18n';
import { AppSidebarItem, Store } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/shared/locale/locale-context';

/** عنصر تنقّل الكتالوج، مستقل عشان قائمة التنقّل تفضل داخل حد الدالة. */
export function CatalogNavItem() {
  const locale = useLocale();
  const pathname = usePathname();
  return (
    <AppSidebarItem
      asChild
      icon={<Store />}
      label={t(locale, 'catalogServices.listTitle')}
      active={pathname.startsWith('/catalog')}
    >
      <Link href="/catalog" />
    </AppSidebarItem>
  );
}
