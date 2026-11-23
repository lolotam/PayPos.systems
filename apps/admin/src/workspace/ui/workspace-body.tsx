'use client';

import { t } from '@pospay/i18n';
import type { ReactNode } from 'react';
import { Building2, CircleAlert, EmptyState, LoaderCircle } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

import { useWorkspace } from '../model/workspace-provider';
import { CreateCompanyScreen } from './create-company-screen';

export function WorkspaceBody({
  children,
  allowsLinkedWorkspace = false,
}: {
  children: ReactNode;
  allowsLinkedWorkspace?: boolean;
}) {
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
    return <CreateCompanyScreen />;
  }
  if (workspace.status === 'choose' && !allowsLinkedWorkspace) {
    return <EmptyState icon={<Building2 />} title={t(locale, 'admin.choosePrompt')} />;
  }
  return children;
}
