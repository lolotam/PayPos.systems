'use client';

import type { CommissionStatementView } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * تنبيه «اتغيّر بعد المراجعة» (FR-025): بيظهر لقارئ النشاط على كشف REVIEWED اتغيّرت مدخلاته أو بياناته بعد
 * المراجعة، وبيقول السبب والخطوة الجاية (الإرجاع للمسودة).
 */
export function StatementChangedNotice({ reading }: { reading: CommissionStatementView }) {
  const locale = useLocale();
  if (reading.status !== 'REVIEWED' || !reading.changed_since_review) return null;
  const cause =
    reading.change_cause === 'STATEMENT'
      ? t(locale, 'commissionStatementScreen.changedStatement')
      : t(locale, 'commissionStatementScreen.changedInputs');
  return (
    <div role="alert" className="rounded-card border border-border p-3">
      <p className="font-semibold">{t(locale, 'commissionStatementScreen.changedTitle')}</p>
      <p>{cause}</p>
    </div>
  );
}
