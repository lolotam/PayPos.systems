import type { MarkCommissionStatementPaidResponse } from '@pospay/contracts';
import { roundCashPayable } from '@pospay/commissions-engine';
import { localDate } from '@pospay/i18n';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { CommissionStatementPayError } from '../../domain/errors.ts';
import {
  frozenEmployeePayables,
  paidOnRefusal,
  statementPayments,
} from '../../domain/statement-payment.ts';
import type {
  CommissionStatementPayTransactions,
  MarkStatementPaidCommand,
  MarkStatementPaidScope,
} from '../../ports/commission-statement-pay-transactions.port.ts';

export { CommissionStatementPayError };

/** بيسجّل صرف كشف الشهر المعتمد في معاملة واحدة: أعمدة الدفع وصف دفع لكل موظفة مجمّدة والتدقيق. */
/** بيسجّل صرف كشف الشهر المعتمد في معاملة واحدة: أعمدة الدفع وصف دفع لكل موظفة مجمّدة والتدقيق. */
export class MarkCommissionStatementPaidUseCase {
  constructor(
    private readonly transactions: CommissionStatementPayTransactions,
    private readonly clock: Clock,
  ) {}

  execute(command: MarkStatementPaidCommand): Promise<MarkCommissionStatementPaidResponse> {
    return this.transactions.run(command, (scope) => markStatementPaid(scope, command, this.clock));
  }
}

/** الخطوات الداخلية لمسار HTTP؛ قاعدة الفلوس كلها في domain/statement-payment.ts. */
export async function markStatementPaid(
  scope: MarkStatementPaidScope,
  command: MarkStatementPaidCommand,
  clock: Clock,
): Promise<MarkCommissionStatementPaidResponse> {
  const locked = await scope.lockStatement();
  if (locked.status === 'PAID') {
    throw new CommissionStatementPayError('COMMISSION_STATEMENT_ALREADY_PAID');
  }
  if (locked.status !== 'APPROVED') {
    throw new CommissionStatementPayError('COMMISSION_STATEMENT_NOT_APPROVED');
  }
  const accessFailure = await scope.recheckAccess();
  if (accessFailure !== null) throw new CommissionStatementPayError(accessFailure);
  const calendar = await scope.calendar();
  if (calendar === null) throw new Error('The statement business has no timezone');
  if (locked.approvedAt === null) throw new Error('An approved statement has no approval date');
  // تاريخ الصرف بيتبنى على تقويم النشاط: مش قبل تاريخ الاعتماد ومش بعد النهارده (FR-037).
  const paidOnFailure = paidOnRefusal(
    command.input.paid_on,
    localDate(locked.approvedAt, calendar.timeZone),
    localDate(clock.now(), calendar.timeZone),
  );
  if (paidOnFailure !== null) throw new CommissionStatementPayError(paidOnFailure);
  const frozen = await scope.frozenLines(locked.statementId);
  const payments = statementPayments(
    command.input.paid_method,
    frozenEmployeePayables(frozen),
    roundCashPayable,
  );
  const record = {
    statementId: locked.statementId,
    period: command.period,
    paidBy: command.userId,
    paidOn: command.input.paid_on,
    paidMethod: command.input.paid_method,
    paidNote: command.input.paid_note ?? null,
    payments: payments.rows,
  };
  const paid = await scope.markPaid(record);
  await scope.audit({ ...record, paidAt: paid.paidAt, paidTotal: payments.paidTotal });
  return {
    business_id: command.businessId,
    period: command.period,
    status: 'PAID',
    paid_by: command.userId,
    paid_at: paid.paidAt,
    paid_on: command.input.paid_on,
    paid_method: command.input.paid_method,
    paid_note: command.input.paid_note ?? null,
    paid_total: payments.paidTotal,
    payments: payments.rows.map((row) => ({
      employee_id: row.employeeId,
      exact_payable: row.exactPayable,
      paid_amount: row.paidAmount,
    })),
  };
}
