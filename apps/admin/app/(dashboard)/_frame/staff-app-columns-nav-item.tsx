'use client';

import { t } from '@pospay/i18n';
import { AppSidebarItem, UserRound } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSessionUser } from '@/session/api/use-session';
import { useStaffColumns } from '@/settings/staff-app-columns/api/use-staff-columns';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function StaffAppColumnsNavItem() {
  const locale = useLocale();
  const pathname = usePathname();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready' ? workspace : null;
  const access = useStaffColumns(ready?.company.id, userId, ready?.business?.id);
  // المدخل بيظهر بس لو قراءة الأعمدة نجحت للنشاط الحالي: الرفض أو الخطأ بيخفيه.
  if (!ready?.business || userId === null || access.isPending || access.isError) return null;
  return (
    <AppSidebarItem
      asChild
      icon={<UserRound />}
      label={t(locale, 'staffAppColumns.title')}
      active={pathname === '/staff-app-columns'}
    >
      <Link href="/staff-app-columns" />
    </AppSidebarItem>
  );
}
