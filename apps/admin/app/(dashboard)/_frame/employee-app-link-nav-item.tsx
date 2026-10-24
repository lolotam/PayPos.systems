'use client';

import { t } from '@pospay/i18n';
import { AppSidebarItem, Smartphone } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeAppLink } from '@/staff/api/use-employee-app-link';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function EmployeeAppLinkNavItem() {
  const locale = useLocale();
  const pathname = usePathname();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready' ? workspace : null;
  const read = useEmployeeAppLink(ready?.company.id, userId, ready?.business?.id);
  if (!ready?.business || userId === null || !read.isSuccess) return null;
  return (
    <AppSidebarItem
      asChild
      icon={<Smartphone />}
      label={t(locale, 'employeeAppLink.title')}
      active={pathname === '/staff/employee-app-link'}
    >
      <Link href="/staff/employee-app-link" />
    </AppSidebarItem>
  );
}
