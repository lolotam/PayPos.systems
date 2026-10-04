import type { EmployeeImportStatus } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

/** حالة الاستيراد من قبول الطلب حتى نتيجة الوظيفة النهائية. */
export function EmployeeImportResult({
  accepted,
  status,
}: {
  accepted: boolean;
  status: EmployeeImportStatus | undefined;
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
  return accepted ? <p role="status">{t(locale, 'employeeImport.pending')}</p> : null;
}
