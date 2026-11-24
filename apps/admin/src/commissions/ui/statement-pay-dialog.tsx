'use client';

import type { MarkCommissionStatementPaidInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { employeeName, formatAmount } from '../model/statement-display';
import { statementFailure } from '../model/statement-messages';
import type { StatementReading } from '../model/statement-reading';
import { sumAmounts } from '../model/statement-sum';
import { StatementFailureNotice } from './statement-failure-notice';
import { StatementPayForm } from './statement-pay-form';

const NS = 'commissionStatementScreen';

export function StatementPayDialog(props: {
  reading: StatementReading;
  pending: boolean;
  error: unknown;
  onConfirm(body: MarkCommissionStatementPaidInput): void;
  onClose(): void;
  onReload(): void;
}) {
  const { reading, pending, error, onConfirm, onClose, onReload } = props;
  const locale = useLocale();
  const payables = reading.employees.map((employee) => employee.payable);
  return (
    <ModalDialog title={t(locale, `${NS}.payTitle`)} pending={pending} onClose={onClose}>
      <p>{t(locale, `${NS}.exactPayable`)}</p>
      <ul>
        {reading.employees.map((employee) => (
          <li key={employee.employee_id}>
            {employeeName(employee, locale)}: <bdi>{formatAmount(employee.payable)}</bdi>
          </li>
        ))}
      </ul>
      <p>{t(locale, `${NS}.exactTotal`)}: <bdi>{formatAmount(sumAmounts(payables))}</bdi></p>
      <p>{t(locale, `${NS}.cashRounding`)}</p>
      <StatementPayForm pending={pending} onSubmit={onConfirm} onCancel={onClose}>
        {error === null || error === undefined ? null : (
          <StatementFailureNotice failure={statementFailure(error, locale)} employees={reading.employees} onReload={onReload} />
        )}
      </StatementPayForm>
    </ModalDialog>
  );
}
