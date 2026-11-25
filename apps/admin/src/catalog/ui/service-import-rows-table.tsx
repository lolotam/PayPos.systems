'use client';
import type { ServiceImportRow } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { serviceImportRuleDisplay } from '../model/service-import-rule';

const HEADER_ROW_CLASS = 'bg-transparent!';
const HEADER_CELL_CLASS = 'text-sm! font-bold! text-inherit!';

type ServiceImportRowsTableProps = {
  rows: readonly ServiceImportRow[];
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
};

const HEADER_KEYS = [
  'row',
  'colNameEn',
  'colNameAr',
  'colPrice',
  'colDuration',
  'colCategory',
  'colCommission',
  'colThreshold',
] as const;

/** رأس جدول المعاينة: عناوين الأعمدة بالترتيب نفسه لخلايا كل صف. */
function ServiceImportRowsHeader() {
  const locale = useLocale();
  return (
    <thead role="rowgroup" className={HEADER_ROW_CLASS}>
      <tr role="row">
        {HEADER_KEYS.map((key) => (
          <th key={key} scope="col" role="columnheader" className={HEADER_CELL_CLASS}>
            {t(locale, `catalogServiceImport.${key}`)}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** صف واحد من الصفوف التي ستُحفظ، مع تسمية كل خلية للعرض المكدّس. */
function ServiceImportRowItem({ row }: { row: ServiceImportRow }) {
  const locale = useLocale();
  const rule = serviceImportRuleDisplay(row, locale);
  const empty = t(locale, 'catalogServiceImport.emptyValue');
  const label = (key: (typeof HEADER_KEYS)[number]) => t(locale, `catalogServiceImport.${key}`);
  return (
    <tr role="row">
      <td role="cell">
        <span dir="ltr">{row.row}</span>
      </td>
      <td role="cell" data-cell-label={label('colNameEn')}>
        {row.name_en}
      </td>
      <td role="cell" data-cell-label={label('colNameAr')}>
        {row.name_ar ?? empty}
      </td>
      <td role="cell" data-cell-label={label('colPrice')}>
        <span dir="ltr">{row.price}</span>
      </td>
      <td role="cell" data-cell-label={label('colDuration')}>
        {row.duration_minutes === null ? empty : <span dir="ltr">{row.duration_minutes}</span>}
      </td>
      <td role="cell" data-cell-label={label('colCategory')}>
        {row.category_name_en ?? empty}
      </td>
      <td role="cell" data-cell-label={label('colCommission')}>
        <span>{rule.label}</span>
        {rule.value ? (
          <span dir="ltr" className="ms-1">
            {rule.value}
          </span>
        ) : null}
      </td>
      <td role="cell" data-cell-label={label('colThreshold')}>
        {row.counts_toward_threshold
          ? t(locale, 'catalogServiceImport.booleanYes')
          : t(locale, 'catalogServiceImport.booleanNo')}
      </td>
    </tr>
  );
}

/** جدول الصفوف النظيفة: ما سيُحفظ بالضبط، مع زر تحميل المزيد لبقية الصفوف. */
export function ServiceImportRowsTable({
  rows,
  nextCursor,
  loadingMore,
  onLoadMore,
}: ServiceImportRowsTableProps) {
  const locale = useLocale();
  return (
    <DataTableFrame
      stacked
      footer={
        nextCursor === null ? null : (
          <div className="flex justify-center">
            <Button type="button" variant="outline" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore
                ? t(locale, 'catalogServiceImport.loadingMoreRows')
                : t(locale, 'catalogServiceImport.loadMoreRows')}
            </Button>
          </div>
        )
      }
    >
      <table role="table" className="w-full text-start text-sm">
        <caption className="px-4 pt-3 text-start">
          {t(locale, 'catalogServiceImport.rowsTitle')}
        </caption>
        <ServiceImportRowsHeader />
        <tbody role="rowgroup">
          {rows.map((row) => (
            <ServiceImportRowItem key={row.row} row={row} />
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
