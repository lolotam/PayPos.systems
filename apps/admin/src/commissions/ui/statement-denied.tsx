'use client';

import { t } from '@pospay/i18n';
import { EmptyState, UserRound } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

/** حالة «مفيش صلاحية»: القراءة اترفضت برفض الصلاحية الموحّد، فمفيش أرقام ولا أزرار. */
export function StatementDenied() {
  const locale = useLocale();
  return (
    <EmptyState
      icon={<UserRound />}
      tone="danger"
      title={t(locale, 'commissionStatementScreen.deniedTitle')}
      description={t(locale, 'commissionStatementScreen.deniedBody')}
    />
  );
}
