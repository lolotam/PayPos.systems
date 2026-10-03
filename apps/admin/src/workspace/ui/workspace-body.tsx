'use client';

import { t } from '@pospay/i18n';
import type { ReactNode } from 'react';
import { EmptyState, Building2, CircleAlert, LoaderCircle } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

import { useWorkspace } from '../model/workspace-provider';

export function WorkspaceBody({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const workspace = useWorkspace();
  if (workspace.status === 'loading') {
    return <EmptyState role="status" icon={<LoaderCircle />} title={t(locale, 'admin.loading')} />;
  }
  if (workspace.status === 'error') {
    return (
      <EmptyState role="alert" tone="danger" icon={<CircleAlert />} title={workspace.message} />
    );
  }
  if (workspace.status === 'empty') {
    return (
      <EmptyState
        icon={<Building2 />}
        title={t(locale, 'admin.workspaceEmptyTitle')}
        description={t(locale, 'admin.workspaceEmptyBody')}
      />
    );
  }
  if (workspace.status === 'choose') {
    return <EmptyState icon={<Building2 />} title={t(locale, 'admin.choosePrompt')} />;
  }
  return children;
}
