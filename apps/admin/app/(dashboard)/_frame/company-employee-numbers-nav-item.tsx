'use client';
import { t } from '@pospay/i18n';
import { AppSidebarItem, UserRound } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/shared/locale/locale-context';

export function CompanyEmployeeNumbersNavItem() {
  const locale = useLocale();
  const pathname = usePathname();
  return (
    <AppSidebarItem
      asChild
      icon={<UserRound />}
      label={t(locale, 'companyEmployeeNumbers.title')}
      active={pathname === '/staff/employee-numbers'}
    >
      <Link href="/staff/employee-numbers" />
    </AppSidebarItem>
  );
}
