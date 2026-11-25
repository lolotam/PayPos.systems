import type { PackageImportPreviewStatus } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { packageImportStatusErrorMessage } from '../model/package-import-status';

type PackageImportResultProps = {
  previewAccepted: boolean;
  commitAccepted: boolean;
  status: PackageImportPreviewStatus | undefined;
  timedOut?: boolean;
};

/** حالة الاستيراد من قبول المعاينة أو الحفظ حتى نتيجة الوظيفة النهائية. */
export function PackageImportResult({
  previewAccepted,
  commitAccepted,
  status,
  timedOut = false,
}: PackageImportResultProps) {
  const locale = useLocale();
  if (status?.status === 'committed')
    return (
      <>
        <p role="status">
          {t(locale, 'packageImport.committed')} {status.created_count}
        </p>
        {status.skipped_count > 0 ? (
          <p>
            {t(locale, 'packageImport.skippedCount')} {status.skipped_count}
          </p>
        ) : null}
      </>
    );
  if (status?.status === 'failed')
    return (
      <p role="alert">
        {t(locale, 'packageImport.failed')}{' '}
        {t(locale, packageImportStatusErrorMessage(status.error_code))}
      </p>
    );
  if (timedOut) return <p role="status">{t(locale, 'packageImport.delayed')}</p>;
  const awaitingPreview = !commitAccepted && (previewAccepted || status?.status === 'pending');
  const awaitingCommit = commitAccepted || status?.status === 'commit_requested';
  return awaitingPreview || awaitingCommit ? (
    <p role="status">{t(locale, 'packageImport.pending')}</p>
  ) : null;
}
