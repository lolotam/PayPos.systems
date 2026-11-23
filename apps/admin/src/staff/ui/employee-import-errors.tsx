'use client';
import type { EmployeeImportPreview } from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

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
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              {t(locale, 'employeeImport.row')}
            </th>
            <th scope="col" role="columnheader">
              {t(locale, 'employeeImport.column')}
            </th>
            <th scope="col" role="columnheader">
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
