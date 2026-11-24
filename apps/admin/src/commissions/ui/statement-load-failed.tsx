'use client';

import { t } from '@pospay/i18n';
import { Button, CircleAlert, EmptyState } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { statementFailure } from '../model/statement-messages';

/**
 * فشل تحميل الكشف: رسالته المقروءة وزرار «جرّب تاني». الكود الخام ما بيظهرش.
 */
export function StatementLoadFailed({ error, onRetry }: { error: unknown; onRetry(): void }) {
  const locale = useLocale();
  const failure = statementFailure(error, locale);
  return (
    <EmptyState
      icon={<CircleAlert />}
      tone="danger"
      title={t(locale, 'commissionStatementScreen.errorTitle')}
      description={failure.code === null ? t(locale, 'commissionStatementScreen.errorBody') : failure.text}
      action={<Button onClick={onRetry}>{t(locale, 'commissionStatementScreen.retry')}</Button>}
    />
  );
}
