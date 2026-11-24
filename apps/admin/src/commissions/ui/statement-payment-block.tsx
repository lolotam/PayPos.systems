'use client';

import type { CommissionClosedStatementBranchView, CommissionClosedStatementView } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { Card, DataTableFrame, Identifier } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { employeeName, formatAmount, paidMethodKey } from '../model/statement-display';
import { StatementPaymentField } from './statement-payment-field';

const NS = 'commissionStatementScreen';

type PaidReading = CommissionClosedStatementView | CommissionClosedStatementBranchView;

/**
 * بيانات صرف الشهر المصروف: يوم الصرف وطريقته وصف لكل موظفة بصافيها الدقيق وبالمتصرف فعلاً. قارئ النشاط كله
 * بيشوف كمان مجموع المتصرف وملاحظة الصرف ووقت التسجيل ومين سجّله؛ قارئ الفروع بيشوف اللي السيرفر رجّعه له بس.
 * الملاحظة نص حر، فبتتعرض كنص عادي مش HTML.
 */
export function StatementPaymentBlock({ reading }: { reading: PaidReading }) {
  const locale = useLocale();
  const { payment } = reading;
  if (payment === null) return null;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nameOf = (employeeId: string) => {
    const match = reading.employees.find((employee) => employee.employee_id === employeeId);
    return match === undefined ? employeeId : employeeName(match, locale);
  };
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-lg font-bold">{t(locale, `${NS}.paymentTitle`)}</h2>
      <dl className="grid grid-cols-2 gap-3">
        <StatementPaymentField label={t(locale, `${NS}.paymentPaidOn`)}>
          <bdi>{payment.paid_on}</bdi>
        </StatementPaymentField>
        <StatementPaymentField label={t(locale, `${NS}.paymentMethod`)}>{t(locale, paidMethodKey(payment.paid_method))}</StatementPaymentField>
        {'paid_total' in payment ? (
          <>
            <StatementPaymentField label={t(locale, `${NS}.paymentTotal`)}>
              <bdi>{formatAmount(payment.paid_total)}</bdi>
            </StatementPaymentField>
            <StatementPaymentField label={t(locale, `${NS}.paymentRecordedAt`)}>
              {formatInstant(new Date(payment.paid_at), locale, zone)}
            </StatementPaymentField>
            <StatementPaymentField label={t(locale, `${NS}.paymentRecordedBy`)}>
              <Identifier value={payment.paid_by} />
            </StatementPaymentField>
            {payment.paid_note === null ? null : (
              <StatementPaymentField label={t(locale, `${NS}.paymentNote`)}>
                <span className="whitespace-pre-wrap">{payment.paid_note}</span>
              </StatementPaymentField>
            )}
          </>
        ) : null}
      </dl>
      <DataTableFrame stacked>
        <table>
          <thead>
            <tr>
              <th scope="col">{t(locale, `${NS}.paymentColEmployee`)}</th>
              <th scope="col">{t(locale, `${NS}.paymentColExact`)}</th>
              <th scope="col">{t(locale, `${NS}.paymentColPaid`)}</th>
            </tr>
          </thead>
          <tbody>
            {payment.payments.map((row) => (
              <tr key={row.employee_id}>
                <td>{nameOf(row.employee_id)}</td>
                <td data-cell-label={t(locale, `${NS}.paymentColExact`)} dir="ltr">{formatAmount(row.exact_payable)}</td>
                <td data-cell-label={t(locale, `${NS}.paymentColPaid`)} dir="ltr">{formatAmount(row.paid_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableFrame>
    </Card>
  );
}
