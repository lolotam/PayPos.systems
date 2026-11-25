'use client';
import type { ServiceImportRowError } from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

// الإطار يلوّن ترويسة الجدول؛ هذا الجدول على `main` بترويسة عادية، فنعيدها محليًا
// بـ`!` (أقوى من محدّدات الإطار) دون تعديل packages/ui.
const HEADER_ROW_CLASS = 'bg-transparent!';
const HEADER_CELL_CLASS = 'text-sm! font-bold! text-inherit!';

/** جدول أخطاء المعاينة: صف وعمود وسبب مترجم من مفاتيح i18n. */
export function ServiceImportErrors({
  errorCount,
  errors,
}: {
  errorCount: number;
  errors: readonly ServiceImportRowError[];
}) {
  const locale = useLocale();
  if (errorCount === 0) return <p role="status">{t(locale, 'catalogServiceImport.clean')}</p>;
  return (
    <DataTableFrame stacked>
      <table role="table" className="w-full text-start text-sm">
        <caption className="px-4 pt-3 text-start">
          {t(locale, 'catalogServiceImport.errorsTitle')}
        </caption>
        <thead role="rowgroup" className={HEADER_ROW_CLASS}>
          <tr role="row">
            <th scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
              {t(locale, 'catalogServiceImport.row')}
            </th>
            <th scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
              {t(locale, 'catalogServiceImport.column')}
            </th>
            <th scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
              {t(locale, 'catalogServiceImport.reason')}
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {errors.map((row) => (
            <tr key={`${row.row}:${row.column}:${row.code}`} role="row">
              <td role="cell">
                <span dir="ltr">{row.row}</span>
              </td>
              <td role="cell" data-cell-label={t(locale, 'catalogServiceImport.column')}>
                {t(locale, `catalogServiceImport.column_${row.column}` as MessageKey)}
              </td>
              <td role="cell" data-cell-label={t(locale, 'catalogServiceImport.reason')}>
                {t(locale, `catalogServiceImport.code_${row.code}` as MessageKey)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
