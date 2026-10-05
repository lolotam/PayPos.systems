import type { EmployeeImportStatus } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

/** حالة الاستيراد من قبول الطلب حتى نتيجة الوظيفة النهائية. */
export function EmployeeImportResult({
  accepted,
  status,
  timedOut = false,
}: {
  accepted: boolean;
  status: EmployeeImportStatus | undefined;
  timedOut?: boolean;
}) {
  const locale = useLocale();
  if (status?.status === 'committed')
    return (
      <p role="status">
        {t(locale, 'employeeImport.committed')} {status.created_count}
      </p>
    );
  if (status?.status === 'failed')
    return (
      <p role="alert">
        {t(locale, 'employeeImport.failed')}
        {status.error_code ? ` ${t(locale, `errors.${status.error_code}`)}` : ''}
      </p>
    );
  if (timedOut) return <p role="status">{t(locale, 'employeeImport.delayed')}</p>;
  return accepted || status?.status === 'commit_requested' ? (
    <p role="status">{t(locale, 'employeeImport.pending')}</p>
  ) : null;
}
