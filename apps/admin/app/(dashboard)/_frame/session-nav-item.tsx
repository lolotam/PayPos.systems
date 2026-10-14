'use client';
import { t } from '@pospay/i18n';
import { AppSidebarItem, UserRound } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/shared/locale/locale-context';

export function SessionNavItem() {
  const locale = useLocale();
  return (
    <AppSidebarItem
      asChild
      icon={<UserRound />}
      label={t(locale, 'serviceSessions.title')}
      active={usePathname() === '/orders/service-sessions/new'}
    >
      <Link href="/orders/service-sessions/new" />
    </AppSidebarItem>
  );
}
