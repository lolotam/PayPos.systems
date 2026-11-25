'use client';
import type { PackageImportPreviewStatus } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { packageImportColumnLabel, packageImportErrorReason } from '../model/package-import-status';

// الإطار يلوّن ترويسة الجدول؛ هذا الجدول بترويسة عادية، فنعيدها محليًا بـ`!` دون تعديل packages/ui.
const HEADER_ROW_CLASS = 'bg-transparent!';
const HEADER_CELL_CLASS = 'text-sm! font-bold! text-inherit!';

type ReadyStatus = Extract<PackageImportPreviewStatus, { status: 'ready' }>;

/** ملخص المعاينة الجاهزة: عدد الباقات والمتخطى، ثم رسالة النظافة أو جدول الأخطاء بصف وعمود وسبب. */
export function PackageImportErrors({ status }: { status: ReadyStatus }) {
  const locale = useLocale();
  return (
    <>
      <p>
        {t(locale, 'packageImport.rowCount')} <span dir="ltr">{status.row_count}</span>
      </p>
      <p>
        {t(locale, 'packageImport.skippedCount')} <span dir="ltr">{status.skipped_count}</span>
      </p>
      {status.error_count === 0 ? (
        <p role="status">{t(locale, 'packageImport.clean')}</p>
      ) : (
        <DataTableFrame stacked>
          <table role="table" className="w-full text-start text-sm">
            <caption className="px-4 pt-3 text-start">
              {t(locale, 'packageImport.errorsTitle')}
            </caption>
            <thead role="rowgroup" className={HEADER_ROW_CLASS}>
              <tr role="row">
                <th scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
                  {t(locale, 'packageImport.row')}
                </th>
                <th scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
                  {t(locale, 'packageImport.column')}
                </th>
                <th scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
                  {t(locale, 'packageImport.reason')}
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {status.errors.map((error) => (
                <tr key={`${error.row}:${error.column}:${error.code}`} role="row">
                  <td role="cell">
                    <span dir="ltr">{error.row}</span>
                  </td>
                  <td role="cell" data-cell-label={t(locale, 'packageImport.column')}>
                    {packageImportColumnLabel(locale, error.column)}
                  </td>
                  <td role="cell" data-cell-label={t(locale, 'packageImport.reason')}>
                    {packageImportErrorReason(locale, error.code)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableFrame>
      )}
    </>
  );
}
