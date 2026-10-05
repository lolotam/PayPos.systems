'use client';

import { t } from '@pospay/i18n';
import type { ReactNode } from 'react';
import { CircleAlert, EmptyState } from '@pospay/ui';

import { useSession, useSessionAccount } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { LocaleSwitch } from '@/shared/locale/locale-switch';
import { WorkspaceBody } from '@/workspace/ui/workspace-body';
import { useWorkspace } from '@/workspace/model/workspace-provider';
import { NotificationBell } from '@/notifications/ui/notification-bell';

import { AppFrame } from '@/shared/frame/app-frame';
import { DashboardSidebar } from './dashboard-sidebar';

export function DashboardFrame({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const mounted = useMounted();
  const session = useSession(mounted);
  const account = useSessionAccount(mounted);
  const userId = account?.id ?? null;
  const workspace = useWorkspace();
  const companyId = workspace.status === 'ready' ? workspace.company.id : undefined;
  return (
    <AppFrame
      brand={t(locale, 'admin.appName')}
      sidebar={<DashboardSidebar account={account} />}
      actions={
        <>
          <NotificationBell
            key={`${companyId ?? 'unselected'}:${userId ?? 'anonymous'}`}
            companyId={companyId}
            userId={userId}
          />
          <LocaleSwitch />
        </>
      }
    >
      {session.isError ? (
        <EmptyState
          role="alert"
          className="mb-12"
          tone="danger"
          icon={<CircleAlert />}
          title={t(locale, 'admin.unexpected')}
        />
      ) : null}
      <WorkspaceBody>{children}</WorkspaceBody>
    </AppFrame>
  );
}
