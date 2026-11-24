'use client';

import type { CommissionStatementRow } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import {
  correctionDate,
  correctionsTotal,
  formatAmount,
  kindKey,
  serviceName,
} from '../model/statement-display';

const COL = 'commissionStatementScreen';

/**
 * قسم «تصحيحات شهور سابقة» (CS-Q9): سطر لكل خدمة اتأثرت بالتاريخ والخدمة والشهر الأصلي وكان كام وبقى كام
 * والفرق، وتحتها مجموع القسم. الموظفة بتشوفه زي المدير، واسم العميلة مش بيتعرض هنا.
 */
export function StatementCorrectionsSection({ rows }: { rows: readonly CommissionStatementRow[] }) {
  const locale = useLocale();
  return (
    <DataTableFrame
      title={t(locale, `${COL}.sectionCorrections`)}
      stacked
      footer={
        <p className="flex justify-between gap-2 font-semibold">
          <span>{t(locale, `${COL}.correctionsTotal`)}</span>
          <span dir="ltr">{correctionsTotal(rows)}</span>
        </p>
      }
    >
      <table>
        <thead>
          <tr>
            <th scope="col">{t(locale, `${COL}.colDate`)}</th>
            <th scope="col">{t(locale, `${COL}.colService`)}</th>
            <th scope="col">{t(locale, 'commissionStatement.sourcePeriod')}</th>
            <th scope="col">{t(locale, 'commissionStatement.previousAmount')}</th>
            <th scope="col">{t(locale, 'commissionStatement.newAmount')}</th>
            <th scope="col">{t(locale, `${COL}.colDifference`)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.source_ref}>
              <td dir="ltr">{correctionDate(row) ?? ''}</td>
              <td data-cell-label={t(locale, `${COL}.colService`)}>
                {serviceName(row, locale) ?? t(locale, kindKey(row.kind))}
                {row.kind === 'CORRECTION_TIP_CASH' ? ` (${t(locale, `${COL}.cashTipNote`)})` : ''}
              </td>
              <td data-cell-label={t(locale, 'commissionStatement.sourcePeriod')} dir="ltr">{row.source_period ?? ''}</td>
              <td data-cell-label={t(locale, 'commissionStatement.previousAmount')} dir="ltr">
                {row.previous_amount === null ? '' : formatAmount(row.previous_amount)}
              </td>
              <td data-cell-label={t(locale, 'commissionStatement.newAmount')} dir="ltr">
                {row.new_amount === null ? '' : formatAmount(row.new_amount)}
              </td>
              <td data-cell-label={t(locale, `${COL}.colDifference`)} dir="ltr">{formatAmount(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
