'use client';

import { t } from '@pospay/i18n';
import { AppSidebarItem, Building2 } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBusinessIdentityAccess } from '@/business-identity/api/use-business-identity-access';
import { useSessionUser } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function BusinessIdentityNavItem() {
  const locale = useLocale();
  const pathname = usePathname();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready' ? workspace : null;
  const access = useBusinessIdentityAccess(ready?.company.id, userId, ready?.business?.id);
  if (
    !ready?.business ||
    userId === null ||
    access.isPending ||
    access.isError ||
    access.data !== true
  ) {
    return null;
  }
  return (
    <AppSidebarItem
      asChild
      icon={<Building2 />}
      label={t(locale, 'businessIdentity.title')}
      active={pathname === '/business-identity'}
    >
      <Link href="/business-identity" />
    </AppSidebarItem>
  );
}
