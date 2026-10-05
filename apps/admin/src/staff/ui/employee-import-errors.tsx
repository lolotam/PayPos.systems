'use client';
import type { EmployeeImportPreview } from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

/** جدول أخطاء المعاينة: صف وcolumn وسبب مترجم من مفاتيح i18n. */
export function EmployeeImportErrors({ preview }: { preview: EmployeeImportPreview }) {
  const locale = useLocale();
  if (preview.error_count === 0)
    return <p role="status">{t(locale, 'employeeImport.clean')}</p>;
  return (
    <table className="w-full text-start text-sm">
      <caption className="text-start">{t(locale, 'employeeImport.errorsTitle')}</caption>
      <thead>
        <tr>
          <th scope="col">{t(locale, 'employeeImport.row')}</th>
          <th scope="col">{t(locale, 'employeeImport.column')}</th>
          <th scope="col">{t(locale, 'employeeImport.reason')}</th>
        </tr>
      </thead>
      <tbody>
        {preview.errors.map((row) => (
          <tr key={`${row.row}:${row.column}`}>
            <td>{row.row}</td>
            <td>{t(locale, `employeeImport.column_${row.column}` as MessageKey)}</td>
            <td>{t(locale, `employeeImport.code_${row.code}` as MessageKey)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
