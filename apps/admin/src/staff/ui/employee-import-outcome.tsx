'use client';
import type { EmployeeImportPreview, EmployeeImportStatus } from '@pospay/contracts';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeImportErrors } from './employee-import-errors';
import { EmployeeImportResult } from './employee-import-result';

type EmployeeImportOutcomeProps = {
  preview: EmployeeImportPreview | undefined;
  accepted: boolean;
  status: EmployeeImportStatus | undefined;
  timedOut: boolean;
  error: unknown;
};

/** ما يلي كرت الاستيراد: أخطاء المعاينة، ثم حالة الحفظ، ثم رفض السيرفر إن وُجد. */
export function EmployeeImportOutcome({
  preview,
  accepted,
  status,
  timedOut,
  error,
}: EmployeeImportOutcomeProps) {
  const locale = useLocale();
  return (
    <>
      {preview !== undefined ? <EmployeeImportErrors preview={preview} /> : null}
      <EmployeeImportResult accepted={accepted} status={status} timedOut={timedOut} />
      {error ? <p role="alert">{envelopeMessage(error, locale)}</p> : null}
    </>
  );
}
