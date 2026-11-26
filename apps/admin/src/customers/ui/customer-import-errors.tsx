'use client';
import type { CustomerImportRowError } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import {
  customerImportColumnLabel,
  customerImportErrorReason,
} from '../model/customer-import-status';

// الإطار يلوّن ترويسة الجدول؛ هذا الجدول على `main` بترويسة عادية، فنعيدها محليًا
// بـ`!` (أقوى من محدّدات الإطار) دون تعديل packages/ui.
const HEADER_ROW_CLASS = 'bg-transparent!';
const HEADER_CELL_CLASS = 'text-sm! font-bold! text-inherit!';

/** جدول أخطاء المعاينة: صف وعمود وسبب مترجم من مفاتيح i18n. */
export function CustomerImportErrors({
  errorCount,
  errors,
}: {
  errorCount: number;
  errors: readonly CustomerImportRowError[];
}) {
  const locale = useLocale();
  if (errorCount === 0) return <p role="status">{t(locale, 'customerImport.clean')}</p>;
  return (
    <DataTableFrame stacked>
      <table role="table" className="w-full text-start text-sm">
        <caption className="px-4 pt-3 text-start">
          {t(locale, 'customerImport.errorsTitle')}
        </caption>
        <thead role="rowgroup" className={HEADER_ROW_CLASS}>
          <tr role="row">
            <th scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
              {t(locale, 'customerImport.row')}
            </th>
            <th scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
              {t(locale, 'customerImport.column')}
            </th>
            <th scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
              {t(locale, 'customerImport.reason')}
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {errors.map((error) => (
            <tr key={`${error.row}:${error.column}:${error.code}`} role="row">
              <td role="cell">
                <span dir="ltr">{error.row}</span>
              </td>
              <td role="cell" data-cell-label={t(locale, 'customerImport.column')}>
                {customerImportColumnLabel(locale, error.column)}
              </td>
              <td role="cell" data-cell-label={t(locale, 'customerImport.reason')}>
                {customerImportErrorReason(locale, error.code)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
