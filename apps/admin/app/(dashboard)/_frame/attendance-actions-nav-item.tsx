'use client';
import { t } from '@pospay/i18n';
import { AppSidebarItem, CircleAlert, Inbox } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/shared/locale/locale-context';
export function AttendanceActionsNavItem({ kind }: { kind: 'exceptions' | 'requests' }) {
  const locale = useLocale();
  const href = `/staff/attendance-${kind}`;
  return (
    <AppSidebarItem
      asChild
      icon={kind === 'exceptions' ? <CircleAlert /> : <Inbox />}
      label={t(locale, `attendanceActions.${kind}`)}
      active={usePathname() === href}
    >
      <Link href={href} />
    </AppSidebarItem>
  );
}
