'use client';

import { t } from '@pospay/i18n';
import type { ReactNode } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

import { useWorkspace } from '../model/workspace-provider';

export function WorkspaceBody({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const workspace = useWorkspace();
  if (workspace.status === 'loading') {
    return <p className="text-start">{t(locale, 'admin.loading')}</p>;
  }
  if (workspace.status === 'error') {
    return (
      <p role="alert" className="text-start">
        {workspace.message}
      </p>
    );
  }
  if (workspace.status === 'empty') {
    return (
      <section className="flex max-w-xl flex-col gap-2">
        <h1 className="text-start text-xl font-bold">{t(locale, 'admin.workspaceEmptyTitle')}</h1>
        <p className="text-start text-muted-foreground">{t(locale, 'admin.workspaceEmptyBody')}</p>
      </section>
    );
  }
  if (workspace.status === 'choose') {
    return <p className="text-start">{t(locale, 'admin.choosePrompt')}</p>;
  }
  return children;
}
