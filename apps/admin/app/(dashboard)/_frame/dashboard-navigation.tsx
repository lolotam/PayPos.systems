'use client';
import { t } from '@pospay/i18n';
import { AppSidebarGroup, AppSidebarItem, House, Inbox, ShieldCheck, Clock3 } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/shared/locale/locale-context';
import { BusinessIdentityNavItem } from './business-identity-nav-item';
import { CatalogNavItem } from './catalog-nav-item';
import { SessionDayNavItem } from './session-day-nav-item';
import { SessionNavItem } from './session-nav-item';
import { StaffNavigation } from './staff-navigation';

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
      <SessionNavItem />
      <SessionDayNavItem />
      <StaffNavigation />
      <BusinessIdentityNavItem />
    </AppSidebarGroup>
  );
}
