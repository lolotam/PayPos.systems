'use client';

import { t } from '@pospay/i18n';
import { AppSidebarItem, Bell } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSessionUser } from '@/session/api/use-session';
import { useAlertRules } from '@/settings/alert-rules/api/use-alert-rules';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useWorkspace } from '@/workspace/model/workspace-provider';

export function AlertRulesNavItem() {
  const locale = useLocale();
  const pathname = usePathname();
  const userId = useSessionUser(useMounted());
  const workspace = useWorkspace();
  const ready = workspace.status === 'ready' ? workspace : null;
  const access = useAlertRules(ready?.company.id, userId, ready?.business?.id);
  if (!ready?.business || userId === null || access.isPending || access.isError) return null;
  return (
    <AppSidebarItem
      asChild
      icon={<Bell />}
      label={t(locale, 'alertRules.title')}
      active={pathname === '/alert-rules'}
    >
      <Link href="/alert-rules" />
    </AppSidebarItem>
  );
}
