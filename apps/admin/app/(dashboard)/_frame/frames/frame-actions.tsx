'use client';

import { t } from '@pospay/i18n';
import { AccountMenu } from '@pospay/ui';

import { NotificationBell } from '@/notifications/ui/notification-bell';
import { useSessionAccount } from '@/session/api/use-session';
import { useSignOut } from '@/session/api/use-sign-out';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { LocaleSwitch } from '@/shared/locale/locale-switch';
import { useWorkspace } from '@/workspace/model/workspace-provider';

import { useAccountEntries } from './use-account-entries';
import { FrameStyleMenu } from './frame-style-menu';
import { FrameThemeToggle } from './frame-theme-toggle';
import { useFrameLabels } from './use-frame-labels';
import { useNavigationKey } from './use-navigation-key';

/**
 * إجراءات الشريط العلوي المشتركة بين الأنماط الثلاثة: الإشعارات ونمط التنقّل ووضع العرض واللغة وقائمة الحساب.
 * مكانها الشريط العلوي لا تذييل الشريط الجانبي، لأن الشريط الجانبي يخفي رأسه وتذييله في وضع الأيقونات.
 * الأزرار في مجموعة لا تنكمش (كل منها هدف 44px). فشل الخروج يُعلن بتنبيه ظاهر خارج القائمة المغلقة،
 * لأن القائمة تُغلق عند الاختيار فلا يراه من يقرأ نص مدخلها وحده.
 */
export function FrameActions() {
  const labels = useFrameLabels();
  const locale = useLocale();
  const account = useSessionAccount(useMounted());
  const workspace = useWorkspace();
  const signOut = useSignOut();
  const entries = useAccountEntries(signOut);
  const navigationKey = useNavigationKey();
  const userId = account?.id ?? null;
  const companyId = workspace.status === 'ready' ? workspace.company.id : undefined;
  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <NotificationBell
          key={`${companyId ?? 'unselected'}:${userId ?? 'anonymous'}`}
          companyId={companyId}
          userId={userId}
          businessId={workspace.status === 'ready' ? workspace.business?.id : undefined}
        />
        <FrameStyleMenu resetKey={navigationKey} />
        <FrameThemeToggle />
        <LocaleSwitch />
        <AccountMenu
          labels={labels.account}
          {...(account?.name ? { name: account.name } : {})}
          {...(account?.email ? { email: account.email } : {})}
          entries={entries}
          resetKey={navigationKey}
          className="shrink-0"
        />
      </div>
      {signOut.failed ? (
        <p role="alert" className="basis-full text-end text-sm font-semibold text-destructive">
          {t(locale, 'admin.unexpected')}
        </p>
      ) : null}
    </>
  );
}
