'use client';
import { t } from '@pospay/i18n';
import { AppSidebarItem, Clock3 } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/shared/locale/locale-context';
export function AttendanceBoardNavItem() {
  const locale = useLocale();
  return (
    <AppSidebarItem
      asChild
      icon={<Clock3 />}
      label={t(locale, 'attendanceBoard.title')}
      active={usePathname() === '/staff/attendance'}
    >
      <Link href="/staff/attendance" />
    </AppSidebarItem>
  );
}
