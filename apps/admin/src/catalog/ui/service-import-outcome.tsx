'use client';
import type { ServiceImportPreview, ServiceImportRow, ServiceImportStatus } from '@pospay/contracts';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { ServiceImportErrors } from './service-import-errors';
import { ServiceImportResult } from './service-import-result';
import { ServiceImportRowsTable } from './service-import-rows-table';

type ServiceImportOutcomeProps = {
  preview: ServiceImportPreview | undefined;
  rows: readonly ServiceImportRow[];
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
  accepted: boolean;
  status: ServiceImportStatus | undefined;
  timedOut: boolean;
  error: unknown;
};

/** ما يلي كرت الاستيراد: أخطاء المعاينة، ثم الصفوف التي ستُحفظ، ثم حالة الحفظ، ثم رفض السيرفر. */
export function ServiceImportOutcome({
  preview,
  rows,
  nextCursor,
  loadingMore,
  onLoadMore,
  accepted,
  status,
  timedOut,
  error,
}: ServiceImportOutcomeProps) {
  const locale = useLocale();
  return (
    <>
      {preview !== undefined ? (
        <ServiceImportErrors errorCount={preview.error_count} errors={preview.errors} />
      ) : null}
      {preview !== undefined && rows.length > 0 ? (
        <ServiceImportRowsTable
          rows={rows}
          nextCursor={nextCursor}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
        />
      ) : null}
      <ServiceImportResult accepted={accepted} status={status} timedOut={timedOut} />
      {error ? <p role="alert">{envelopeMessage(error, locale)}</p> : null}
    </>
  );
}
