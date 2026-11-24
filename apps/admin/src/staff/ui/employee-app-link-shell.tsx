'use client';
import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

/** إطار صفحة رابط تطبيق الموظفين: الترويسة في مكانها والمحتوى تحتها في كل الحالات. */
export function EmployeeAppLinkShell({ children }: { children: ReactNode }) {
  const locale = useLocale();
  return (
    <PageShell layout="form">
      <PageHeader
        title={t(locale, 'employeeAppLink.title')}
        description={t(locale, 'employeeAppLink.lead')}
      />
      {children}
    </PageShell>
  );
}
