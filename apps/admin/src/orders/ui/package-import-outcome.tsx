'use client';
import type { PackageImportPreviewStatus } from '@pospay/contracts';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { PackageImportErrors } from './package-import-errors';
import { PackageImportResult } from './package-import-result';

type PackageImportOutcomeProps = {
  status: PackageImportPreviewStatus | undefined;
  previewAccepted: boolean;
  commitAccepted: boolean;
  timedOut: boolean;
  error: unknown;
};

/** ما يلي كرت الاستيراد: ملخص المعاينة وأخطاؤها، ثم حالة المعاينة أو الحفظ، ثم رفض السيرفر. */
export function PackageImportOutcome({
  status,
  previewAccepted,
  commitAccepted,
  timedOut,
  error,
}: PackageImportOutcomeProps) {
  const locale = useLocale();
  return (
    <>
      {status?.status === 'ready' ? <PackageImportErrors status={status} /> : null}
      <PackageImportResult
        previewAccepted={previewAccepted}
        commitAccepted={commitAccepted}
        status={status}
        timedOut={timedOut}
      />
      {error ? <p role="alert">{envelopeMessage(error, locale)}</p> : null}
    </>
  );
}
