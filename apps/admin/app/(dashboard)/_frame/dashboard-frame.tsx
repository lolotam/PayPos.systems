'use client';

import { t } from '@pospay/i18n';
import type { ReactNode } from 'react';

import { EnrolLink } from '@/session/ui/enrol-link';
import { SignOutButton } from '@/session/ui/sign-out-button';
import { useSession } from '@/session/api/use-session';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { LocaleSwitch } from '@/shared/locale/locale-switch';
import { WorkspaceBody } from '@/workspace/ui/workspace-body';
import { WorkspaceSelector } from '@/workspace/ui/workspace-selector';
import { useWorkspace } from '@/workspace/model/workspace-provider';
import { NotificationBell } from '@/notifications/ui/notification-bell';

import { AppFrame } from '@/shared/frame/app-frame';

export function DashboardFrame({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const session = useSession(useMounted());
  const workspace = useWorkspace();
  const companyId = workspace.status === 'ready' ? workspace.company.id : undefined;
  return (
    <AppFrame
      brand={t(locale, 'admin.appName')}
      selector={<WorkspaceSelector />}
      actions={
        <>
          <NotificationBell key={companyId ?? 'unselected'} companyId={companyId} />
          <EnrolLink />
          <LocaleSwitch />
          <SignOutButton />
        </>
      }
    >
      {session.isError ? (
        <p role="alert" className="mb-4 text-start">
          {t(locale, 'admin.unexpected')}
        </p>
      ) : null}
      <WorkspaceBody>{children}</WorkspaceBody>
    </AppFrame>
  );
}
