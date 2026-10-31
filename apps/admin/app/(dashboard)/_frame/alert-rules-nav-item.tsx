'use client';

import { t } from '@pospay/i18n';
import { AppSidebarItem, Bell } from '@pospay/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSessionUser } from '@/session/api/use-session';
import { useAlertRules } from '@/settings/alert-rules/api/use-alert-rules';
import { useRatingSettings } from '@/settings/alert-rules/api/use-rating-settings';
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
  const rating = useRatingSettings(ready?.company.id, userId, ready?.business?.id);
  // صلاحية طلبات التقييم منفصلة عن صلاحية التنبيهات، فالرابط بيظهر لحد ما تنجح
  // قراءة واحدة على الأقل، ويختفي بس لما القراءتين تفشلوا.
  if (!ready?.business || userId === null) return null;
  if (!access.isSuccess && !rating.isSuccess) return null;
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
