'use client';
import { t } from '@pospay/i18n';
import { AppSidebarItem, UserRound } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/shared/locale/locale-context';

export function PackageSaleNavItem() {
  const locale = useLocale();
  return (
    <AppSidebarItem
      asChild
      icon={<UserRound />}
      label={t(locale, 'packageSale.navTitle')}
      active={usePathname() === '/orders/package-sales/new'}
    >
      <Link href="/orders/package-sales/new" />
    </AppSidebarItem>
  );
}
