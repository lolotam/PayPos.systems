'use client';

import { AccountMenu } from '@pospay/ui';

import { NotificationBell } from '@/notifications/ui/notification-bell';
import { useSessionAccount } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { LocaleSwitch } from '@/shared/locale/locale-switch';
import { useWorkspace } from '@/workspace/model/workspace-provider';

import { useAccountEntries } from './use-account-entries';
import { useFrameLabels } from './use-frame-labels';
import { useNavigationKey } from './use-navigation-key';

/**
 * إجراءات الشريط العلوي المشتركة بين الأنماط الثلاثة: الإشعارات واللغة وقائمة الحساب.
 * مكانها الشريط العلوي لا تذييل الشريط الجانبي، لأن الشريط الجانبي يخفي رأسه وتذييله في وضع الأيقونات.
 */
export function FrameActions() {
  const labels = useFrameLabels();
  const account = useSessionAccount(useMounted());
  const workspace = useWorkspace();
  const entries = useAccountEntries();
  const navigationKey = useNavigationKey();
  const userId = account?.id ?? null;
  const companyId = workspace.status === 'ready' ? workspace.company.id : undefined;
  return (
    <>
      <NotificationBell
        key={`${companyId ?? 'unselected'}:${userId ?? 'anonymous'}`}
        companyId={companyId}
        userId={userId}
        businessId={workspace.status === 'ready' ? workspace.business?.id : undefined}
      />
      <LocaleSwitch />
      <AccountMenu
        labels={labels.account}
        {...(account?.name ? { name: account.name } : {})}
        {...(account?.email ? { email: account.email } : {})}
        entries={entries}
        resetKey={navigationKey}
      />
    </>
  );
}
