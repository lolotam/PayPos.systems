'use client';
import type { EmployeeImportPreview } from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

// الإطار يلوّن ترويسة الجدول (خلفية وخط صغير باهت)؛ هذا الجدول كان على `main` بترويسة عادية في جدول text-sm،
// فنعيدها محليًا بـ`!` (أقوى من محدّدات الإطار) دون تعديل packages/ui.
const HEADER_ROW_CLASS = 'bg-transparent!';
const HEADER_CELL_CLASS = 'text-sm! font-bold! text-inherit!';

/** جدول أخطاء المعاينة: صف وcolumn وسبب مترجم من مفاتيح i18n. */
export function EmployeeImportErrors({ preview }: { preview: EmployeeImportPreview }) {
  const locale = useLocale();
  if (preview.error_count === 0) return <p role="status">{t(locale, 'employeeImport.clean')}</p>;
  return (
    <DataTableFrame stacked>
      <table role="table" className="w-full text-start text-sm">
        <caption className="px-4 pt-3 text-start">
          {t(locale, 'employeeImport.errorsTitle')}
        </caption>
        <thead role="rowgroup" className={HEADER_ROW_CLASS}>
          <tr role="row">
            <th scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
              {t(locale, 'employeeImport.row')}
            </th>
            <th scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
              {t(locale, 'employeeImport.column')}
            </th>
            <th scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
              {t(locale, 'employeeImport.reason')}
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {preview.errors.map((row) => (
            <tr key={`${row.row}:${row.column}`} role="row">
              <td role="cell">{row.row}</td>
              <td role="cell" data-cell-label={t(locale, 'employeeImport.column')}>
                {t(locale, `employeeImport.column_${row.column}` as MessageKey)}
              </td>
              <td role="cell" data-cell-label={t(locale, 'employeeImport.reason')}>
                {t(locale, `employeeImport.code_${row.code}` as MessageKey)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
