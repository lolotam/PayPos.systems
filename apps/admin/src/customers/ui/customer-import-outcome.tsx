'use client';
import type {
  CustomerImportPreview,
  CustomerImportRow,
  CustomerImportStatus,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { CustomerImportErrors } from './customer-import-errors';
import { CustomerImportResult } from './customer-import-result';
import { CustomerImportRowsTable } from './customer-import-rows-table';

type CustomerImportOutcomeProps = {
  preview: CustomerImportPreview | undefined;
  rows: readonly CustomerImportRow[];
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
  accepted: boolean;
  status: CustomerImportStatus | undefined;
  timedOut: boolean;
  error: unknown;
};

/** أعداد المعاينة: صفوف الملف، والجدد، والمسجلون من قبل. */
function CustomerImportSummary({ preview }: { preview: CustomerImportPreview }) {
  const locale = useLocale();
  const counts = [
    ['customerImport.rowCount', preview.row_count],
    ['customerImport.newCount', preview.new_count],
    ['customerImport.existingCount', preview.existing_count],
  ] as const;
  return (
    <ul className="grid gap-1 text-sm">
      {counts.map(([key, value]) => (
        <li key={key}>
          {t(locale, key)} <span dir="ltr">{value}</span>
        </li>
      ))}
    </ul>
  );
}

/** ما يلي كرت الاستيراد: الأعداد، ثم أخطاء المعاينة، ثم الصفوف التي ستُحفظ، ثم حالة الحفظ، ثم رفض السيرفر. */
export function CustomerImportOutcome({
  preview,
  rows,
  nextCursor,
  loadingMore,
  onLoadMore,
  accepted,
  status,
  timedOut,
  error,
}: CustomerImportOutcomeProps) {
  const locale = useLocale();
  return (
    <>
      {preview !== undefined ? <CustomerImportSummary preview={preview} /> : null}
      {preview !== undefined ? (
        <CustomerImportErrors errorCount={preview.error_count} errors={preview.errors} />
      ) : null}
      {preview !== undefined && rows.length > 0 ? (
        <CustomerImportRowsTable
          rows={rows}
          nextCursor={nextCursor}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
        />
      ) : null}
      <CustomerImportResult accepted={accepted} status={status} timedOut={timedOut} />
      {error ? <p role="alert">{envelopeMessage(error, locale)}</p> : null}
    </>
  );
}
