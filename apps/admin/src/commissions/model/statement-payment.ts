import type { CommissionStatementPaidMethod } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';

export const paymentMethodKeys: Record<CommissionStatementPaidMethod, MessageKey> = {
  WITH_SALARY: 'commissionStatementScreen.methodSalary',
  BANK_TRANSFER: 'commissionStatementScreen.methodBank',
  CASH: 'commissionStatementScreen.methodCash',
};

export function defaultPaymentDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
