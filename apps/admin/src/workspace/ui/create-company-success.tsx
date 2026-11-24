'use client';

import { t } from '@pospay/i18n';
import { Building2, Button, EmptyState, PageHeader, PageShell } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

/** حالة ما بعد النجاح اللي ما بترسلش خالص: رسالة إنشاء وزر إعادة تحميل لو قراءة مساحات العمل واقفة. */
export function CreateCompanySuccess({
  reload,
  onReload,
}: {
  reload: boolean;
  onReload: () => void;
}) {
  const locale = useLocale();
  return (
    <PageShell layout="form">
      <PageHeader title={t(locale, 'admin.createCompanyTitle')} />
      <EmptyState
        role="status"
        icon={<Building2 />}
        title={t(locale, 'admin.createCompanyCreatedStatus')}
      />
      {reload ? (
        <Button type="button" onClick={onReload}>
          {t(locale, 'admin.createCompanyReload')}
        </Button>
      ) : null}
    </PageShell>
  );
}
