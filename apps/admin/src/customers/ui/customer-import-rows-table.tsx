'use client';
import type { CustomerImportRow } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

const HEADER_ROW_CLASS = 'bg-transparent!';
const HEADER_CELL_CLASS = 'text-sm! font-bold! text-inherit!';

type CustomerImportRowsTableProps = {
  rows: readonly CustomerImportRow[];
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
};

const HEADER_KEYS = [
  'row',
  'col_name',
  'col_phone',
  'col_locale',
  'col_status',
  'col_warning',
] as const;

/** رأس جدول المعاينة: عناوين الأعمدة بالترتيب نفسه لخلايا كل صف. */
function CustomerImportRowsHeader() {
  const locale = useLocale();
  return (
    <thead role="rowgroup" className={HEADER_ROW_CLASS}>
      <tr role="row">
        {HEADER_KEYS.map((key) => (
          <th key={key} scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
            {t(locale, `customerImport.${key}`)}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** صف واحد من الصفوف التي ستُحفظ؛ الهاتف المقنّع هو الوحيد المعروض من بيانات التواصل. */
function CustomerImportRowItem({ row }: { row: CustomerImportRow }) {
  const locale = useLocale();
  const label = (key: (typeof HEADER_KEYS)[number]) => t(locale, `customerImport.${key}`);
  return (
    <tr role="row">
      <td role="cell">
        <span dir="ltr">{row.row}</span>
      </td>
      <td role="cell" data-cell-label={label('col_name')}>
        {row.name}
      </td>
      <td role="cell" data-cell-label={label('col_phone')}>
        <span dir="ltr">{row.masked_phone}</span>
      </td>
      <td role="cell" data-cell-label={label('col_locale')}>
        {t(locale, row.locale === 'ar' ? 'customerImport.locale_ar' : 'customerImport.locale_en')}
      </td>
      <td role="cell" data-cell-label={label('col_status')}>
        {t(
          locale,
          row.status === 'new' ? 'customerImport.status_new' : 'customerImport.status_existing',
        )}
      </td>
      <td role="cell" data-cell-label={label('col_warning')}>
        {row.warning
          ? t(locale, `customerImport.warning_${row.warning}`)
          : t(locale, 'customerImport.emptyValue')}
      </td>
    </tr>
  );
}

/** جدول الصفوف النظيفة: ما سيُحفظ بالضبط، مع زر تحميل المزيد لبقية الصفوف. */
export function CustomerImportRowsTable({
  rows,
  nextCursor,
  loadingMore,
  onLoadMore,
}: CustomerImportRowsTableProps) {
  const locale = useLocale();
  return (
    <DataTableFrame
      stacked
      footer={
        nextCursor === null ? null : (
          <div className="flex justify-center">
            <Button type="button" variant="outline" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore
                ? t(locale, 'customerImport.loadingMoreRows')
                : t(locale, 'customerImport.loadMoreRows')}
            </Button>
          </div>
        )
      }
    >
      <table role="table" className="w-full text-start text-sm">
        <caption className="px-4 pt-3 text-start">{t(locale, 'customerImport.rowsTitle')}</caption>
        <CustomerImportRowsHeader />
        <tbody role="rowgroup">
          {rows.map((row) => (
            <CustomerImportRowItem key={row.row} row={row} />
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
