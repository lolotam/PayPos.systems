import type { CustomerImportStatus } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { customerImportStatusErrorMessage } from '../model/customer-import-status';

/** حالة الاستيراد من قبول الطلب حتى نتيجة الوظيفة النهائية. */
export function CustomerImportResult({
  accepted,
  status,
  timedOut = false,
}: {
  accepted: boolean;
  status: CustomerImportStatus | undefined;
  timedOut?: boolean;
}) {
  const locale = useLocale();
  if (status?.status === 'committed')
    return (
      <p role="status">
        {t(locale, 'customerImport.committed')} <span dir="ltr">{status.created_count}</span>
      </p>
    );
  if (status?.status === 'failed')
    return (
      <p role="alert">
        {status.error_code
          ? t(locale, customerImportStatusErrorMessage(status.error_code))
          : t(locale, 'customerImport.failed')}
      </p>
    );
  if (timedOut) return <p role="status">{t(locale, 'customerImport.delayed')}</p>;
  return accepted || status?.status === 'commit_requested' ? (
    <p role="status">{t(locale, 'customerImport.pending')}</p>
  ) : null;
}
