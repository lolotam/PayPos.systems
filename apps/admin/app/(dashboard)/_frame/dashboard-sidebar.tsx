'use client';
import { t } from '@pospay/i18n';
import { AppSidebar, BrandLockup } from '@pospay/ui';
import { EnrolLink } from '@/session/ui/enrol-link';
import { SignOutButton } from '@/session/ui/sign-out-button';
import { useLocale } from '@/shared/locale/locale-context';
import { WorkspaceSelector } from '@/workspace/ui/workspace-selector';
import { DashboardNavigation } from './dashboard-navigation';
import type { SessionAccount } from '@/session/api/session-account';
import { DashboardAccount } from './dashboard-account';

export function DashboardSidebar({ account }: { account: SessionAccount | null }) {
  const locale = useLocale();
  return (
    <AppSidebar
      title={t(locale, 'shell.navigation')}
      openLabel={t(locale, 'shell.openNavigation')}
      closeLabel={t(locale, 'shell.closeNavigation')}
      header={
        <>
          <BrandLockup
            tone="light"
            title={t(locale, 'brand.title')}
            latinName={t(locale, 'brand.latinName')}
            arabicName={t(locale, 'brand.arabicName')}
          />
          <WorkspaceSelector />
        </>
      }
      navigation={<DashboardNavigation />}
      footer={
        <>
          <DashboardAccount account={account} />
          <EnrolLink />
          <SignOutButton tone="light" />
        </>
      }
    />
  );
}
