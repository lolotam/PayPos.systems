'use client';

import type { CommissionStatementRow } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { branchName, formatAmount, kindKey, serviceName } from '../model/statement-display';

/** جدول بنود قسم من الكشف: التاريخ والنوع والخدمة والعميلة والفرع والمبلغ كما رجعوا من السيرفر. */
export function StatementRowsTable({
  title,
  rows,
}: {
  title: string;
  rows: readonly CommissionStatementRow[];
}) {
  const locale = useLocale();
  return (
    <DataTableFrame title={title} stacked>
      <table>
        <thead>
          <tr>
            <th scope="col">{t(locale, 'commissionStatementScreen.colDate')}</th>
            <th scope="col">{t(locale, 'commissionStatementScreen.colKind')}</th>
            <th scope="col">{t(locale, 'commissionStatementScreen.colService')}</th>
            <th scope="col">{t(locale, 'commissionStatementScreen.colCustomer')}</th>
            <th scope="col">{t(locale, 'commissionStatementScreen.colBranch')}</th>
            <th scope="col">{t(locale, 'commissionStatementScreen.colAmount')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.source_ref}>
              <td dir="ltr">{row.business_date ?? row.source_business_date ?? ''}</td>
              <td data-cell-label={t(locale, 'commissionStatementScreen.colKind')}>
                {t(locale, kindKey(row.kind))}
                {row.kind === 'TIP_CASH' ? ` (${t(locale, 'commissionStatementScreen.cashTipNote')})` : ''}
              </td>
              <td data-cell-label={t(locale, 'commissionStatementScreen.colService')}>{serviceName(row, locale) ?? ''}</td>
              <td data-cell-label={t(locale, 'commissionStatementScreen.colCustomer')}>{row.customer_name ?? ''}</td>
              <td data-cell-label={t(locale, 'commissionStatementScreen.colBranch')}>{branchName(row, locale) ?? ''}</td>
              <td data-cell-label={t(locale, 'commissionStatementScreen.colAmount')} dir="ltr">
                {formatAmount(row.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
