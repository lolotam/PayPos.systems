'use client';

import { t } from '@pospay/i18n';
import { Button, EmptyState, UserRound } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

/** حالة قفل الوصول: كل حاجة اختفت، والرجوع الوحيد بزرار بيرجّع الوصول بجيل جديد من غير أي بيانات قديمة. */
export function CommissionPlansDenied({ onRetry }: { onRetry(): void }) {
  const locale = useLocale();
  return (
    <EmptyState
      icon={<UserRound />}
      tone="danger"
      title={t(locale, 'commissionPlanBuilder.deniedTitle')}
      description={t(locale, 'commissionPlanBuilder.deniedBody')}
      action={<Button onClick={onRetry}>{t(locale, 'commissionPlanBuilder.tryAgain')}</Button>}
    />
  );
}
