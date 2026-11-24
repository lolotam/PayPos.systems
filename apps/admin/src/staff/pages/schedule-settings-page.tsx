'use client';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { ScheduleWorkspace } from '../api/use-schedules';
import { ScheduleSettingsPanel } from '../ui/schedule-settings-panel';
export function ScheduleSettingsPage({ scope }: { scope: ScheduleWorkspace }) {
  const locale = useLocale();
  return (
    <PageShell layout="form">
      <PageHeader title={t(locale, 'shell.schedule_settings_title')} />
      <ScheduleSettingsPanel
        key={`${scope.companyId}:${scope.businessId}:${scope.userId}`}
        scope={scope}
      />
    </PageShell>
  );
}
