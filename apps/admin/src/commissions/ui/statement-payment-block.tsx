'use client';

import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { employeeName, formatAmount } from '../model/statement-display';
import { paymentMethodKeys } from '../model/statement-payment';
import { isClosedReading, type StatementReading } from '../model/statement-reading';

const NS = 'commissionStatementScreen';

export function StatementPaymentBlock({ reading }: { reading: StatementReading }) {
  const locale = useLocale();
  if (!isClosedReading(reading) || reading.status !== 'PAID' || reading.payment === null) return null;
  const payment = reading.payment;
  const amount = (value: string | null | undefined) => value == null ? t(locale, `${NS}.unavailable`) : formatAmount(value);
  return (
    <section aria-label={t(locale, `${NS}.paymentTitle`)} className="flex flex-col gap-3 rounded-card border border-border p-4">
      <h2>{t(locale, `${NS}.paymentTitle`)}</h2>
      <p>{t(locale, `${NS}.paidOn`)}: <bdi>{payment.paid_on}</bdi></p>
      <p>{t(locale, `${NS}.paidMethod`)}: {t(locale, paymentMethodKeys[payment.paid_method])}</p>
      <table>
        <thead><tr>
          <th scope="col">{t(locale, `${NS}.paymentEmployee`)}</th>
          <th scope="col">{t(locale, `${NS}.exactPayable`)}</th>
          <th scope="col">{t(locale, `${NS}.paidAmount`)}</th>
        </tr></thead>
        <tbody>{payment.payments.map((row) => {
          const employee = reading.employees.find((entry) => entry.employee_id === row.employee_id);
          return (
            <tr key={row.employee_id}>
              <th scope="row">{employee === undefined ? t(locale, `${NS}.unavailable`) : employeeName(employee, locale)}</th>
              <td><bdi>{amount(row.exact_payable)}</bdi></td><td><bdi>{amount(row.paid_amount)}</bdi></td>
            </tr>
          );
        })}</tbody>
      </table>
      {reading.reader_scope === 'BUSINESS' && 'paid_total' in payment ? (
        <dl>
          <dt>{t(locale, `${NS}.paidTotal`)}</dt><dd><bdi>{amount(payment.paid_total)}</bdi></dd>
          <dt>{t(locale, `${NS}.paidNote`)}</dt><dd className="whitespace-pre-wrap">{payment.paid_note ?? t(locale, `${NS}.unavailable`)}</dd>
          <dt>{t(locale, `${NS}.paidAt`)}</dt><dd><bdi>{payment.paid_at}</bdi></dd>
          <dt>{t(locale, `${NS}.paidBy`)}</dt><dd><bdi>{payment.paid_by}</bdi></dd>
        </dl>
      ) : null}
    </section>
  );
}
