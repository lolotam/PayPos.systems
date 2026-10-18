'use client';
import { t } from '@pospay/i18n';
import { AppSidebarItem, Clock3 } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/shared/locale/locale-context';

export function SessionDayNavItem() {
  const locale = useLocale();
  return (
    <AppSidebarItem asChild icon={<Clock3 />} label={t(locale, 'serviceLineEdit.title')} active={usePathname() === '/orders/service-sessions'}>
      <Link href="/orders/service-sessions" />
    </AppSidebarItem>
  );
}
