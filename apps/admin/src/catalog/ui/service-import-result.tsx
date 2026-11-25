import type { ServiceImportStatus } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { serviceImportStatusErrorMessage } from '../model/service-import-status';

/** حالة الاستيراد من قبول الطلب حتى نتيجة الوظيفة النهائية. */
export function ServiceImportResult({
  accepted,
  status,
  timedOut = false,
}: {
  accepted: boolean;
  status: ServiceImportStatus | undefined;
  timedOut?: boolean;
}) {
  const locale = useLocale();
  if (status?.status === 'committed')
    return (
      <p role="status">
        {t(locale, 'catalogServiceImport.committed')} {status.created_count}
      </p>
    );
  if (status?.status === 'failed')
    return (
      <p role="alert">
        {t(locale, 'catalogServiceImport.failed')}
        {status.error_code ? ` ${t(locale, serviceImportStatusErrorMessage(status.error_code))}` : ''}
      </p>
    );
  if (timedOut) return <p role="status">{t(locale, 'catalogServiceImport.delayed')}</p>;
  return accepted || status?.status === 'commit_requested' ? (
    <p role="status">{t(locale, 'catalogServiceImport.pending')}</p>
  ) : null;
}
