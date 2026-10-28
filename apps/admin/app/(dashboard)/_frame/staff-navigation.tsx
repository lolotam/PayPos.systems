'use client';
import { t } from '@pospay/i18n';
import { AppSidebarItem, UserRound, Upload } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/shared/locale/locale-context';
import { AttendanceBoardNavItem } from './attendance-board-nav-item';
import { AttendanceActionsNavItem } from './attendance-actions-nav-item';
import { AttendanceReportNavItem } from './attendance-report-nav-item';
import { AttendanceStatementNavItem } from './attendance-statement-nav-item';
import { CompanyEmployeeNumbersNavItem } from './company-employee-numbers-nav-item';
import { EmployeeAppLinkNavItem } from './employee-app-link-nav-item';

export function StaffNavigation() {
  const locale = useLocale();
  const pathname = usePathname();
  return (
    <>
      <AppSidebarItem
        asChild
        icon={<UserRound />}
        label={t(locale, 'staff.listTitle')}
        active={
          pathname.startsWith('/staff') &&
          !pathname.startsWith('/staff/import') &&
          !pathname.startsWith('/staff/attendance') &&
          !pathname.startsWith('/staff/employee-numbers') &&
          !pathname.startsWith('/staff/employee-app-link')
        }
      >
        <Link href="/staff" />
      </AppSidebarItem>
      <CompanyEmployeeNumbersNavItem />
      <EmployeeAppLinkNavItem />
      <AppSidebarItem
        asChild
        icon={<Upload />}
        label={t(locale, 'employeeImport.title')}
        active={pathname === '/staff/import'}
      >
        <Link href="/staff/import" />
      </AppSidebarItem>
      <AttendanceBoardNavItem />
      <AttendanceActionsNavItem kind="exceptions" />
      <AttendanceActionsNavItem kind="requests" />
      <AttendanceReportNavItem />
      <AttendanceStatementNavItem />
    </>
  );
}
