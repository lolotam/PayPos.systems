'use client';
import { t } from '@pospay/i18n';
import {
  AppSidebarGroup,
  AppSidebarItem,
  House,
  Inbox,
  ShieldCheck,
  UserRound,
  Clock3,
  Upload,
} from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/shared/locale/locale-context';
import { CatalogNavItem } from './catalog-nav-item';

export function DashboardNavigation() {
  const locale = useLocale();
  const pathname = usePathname();
  return (
    <AppSidebarGroup>
      <AppSidebarItem
        asChild
        icon={<Inbox />}
        label={t(locale, 'leave.inbox')}
        active={pathname === '/leave'}
      >
        <Link href="/leave" />
      </AppSidebarItem>
      <AppSidebarItem
        asChild
        icon={<Clock3 />}
        label={t(locale, 'shell.schedule_title')}
        active={pathname === '/schedules'}
      >
        <Link href="/schedules" />
      </AppSidebarItem>
      <AppSidebarItem
        asChild
        icon={<House />}
        label={t(locale, 'admin.homeTitle')}
        active={pathname === '/'}
      >
        <Link href="/" />
      </AppSidebarItem>
      <AppSidebarItem
        asChild
        icon={<ShieldCheck />}
        label={t(locale, 'permissions.title')}
        active={pathname === '/permissions'}
      >
        <Link href="/permissions" />
      </AppSidebarItem>
      <CatalogNavItem />
      <AppSidebarItem
        asChild
        icon={<UserRound />}
        label={t(locale, 'staff.listTitle')}
        active={pathname.startsWith('/staff') && !pathname.startsWith('/staff/import')}
      >
        <Link href="/staff" />
      </AppSidebarItem>
      <AppSidebarItem
        asChild
        icon={<Upload />}
        label={t(locale, 'employeeImport.title')}
        active={pathname === '/staff/import'}
      >
        <Link href="/staff/import" />
      </AppSidebarItem>
    </AppSidebarGroup>
  );
}
