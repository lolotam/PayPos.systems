import {
  projectStatementView,
  type StatementRow,
  type StatementViewScope,
} from '@pospay/commissions-engine';
import type {
  CommissionClosedStatementBranchView,
  CommissionClosedStatementView,
} from '@pospay/contracts';

import { sumPaidAmounts } from '../../domain/statement-payment.ts';
import type { ClosedStatementPayment } from '../../ports/commission-statement.port.ts';
import { employeeContract } from './statement-view-contract.ts';

/** ما يلزم لرد الكشف المغلق: صفوفه المجمّدة وبيانات اعتماده وصرفه المخزّنة ونطاق القارئ. */
export interface ClosedStatementContext {
  readonly businessId: string;
  readonly period: string;
  readonly status: 'APPROVED' | 'PAID';
  /** وقت الاعتماد المخزّن كنص ISO بالـoffset. */
  readonly approvedAt: string;
  readonly inputFingerprint: string;
  readonly statementFingerprint: string;
  /** الصفوف المجمّدة بشكل الباني، بما فيها صف EMPLOYEE لكل موظفة. */
  readonly rows: readonly StatementRow[];
  /** صرف الكشف لما يكون PAID، وإلا null. */
  readonly payment: ClosedStatementPayment | null;
  readonly scope: StatementViewScope;
}

function paymentRows(payment: ClosedStatementPayment, visible: ReadonlySet<string> | null) {
  return payment.payments
    .filter((row) => visible === null || visible.has(row.employeeId))
    .map((row) => ({
      employee_id: row.employeeId,
      exact_payable: row.exactPayable,
      paid_amount: row.paidAmount,
    }));
}

/**
 * يبني رد الكشف المغلق من صفوفه المجمّدة وحدها (FR-025، FR-033): مفيش حساب حي ولا مصدر خارج
 * `commission_statement_lines`. قارئ النشاط كله بياخد البصمتين المجمّدتين وكل بيانات الصرف، وقارئ الفروع بياخد صفوفه
 * المرئية بس حسب `attachedBranchIds` المجمّدة، وصرف موظفاتها المرئيات مع تاريخ الصرف وطريقته، من غير أي حقل على
 * الكشف كله (CM-28c): لا مجموع ولا دافع ولا ملاحظة ولا وقت تسجيل.
 *
 * @param context الصفوف المجمّدة وبيانات الاعتماد والصرف والنطاق
 * @returns رد النشاط كله أو رد الفروع بحسب النطاق
 */
export function closedStatementView(
  context: ClosedStatementContext,
): CommissionClosedStatementView | CommissionClosedStatementBranchView {
  const employees = projectStatementView({
    rows: context.rows,
    failures: [],
    blocked: [],
    unlisted: [],
    scope: context.scope,
  }).map(employeeContract);
  const { payment } = context;
  if (!context.scope.businessWide) {
    const visible = new Set(employees.map((employee) => employee.employee_id));
    return {
      reader_scope: 'BRANCHES',
      business_id: context.businessId,
      period: context.period,
      status: context.status,
      payment:
        payment === null
          ? null
          : {
              paid_on: payment.paidOn,
              paid_method: payment.paidMethod,
              payments: paymentRows(payment, visible),
            },
      employees,
    };
  }
  return {
    reader_scope: 'BUSINESS',
    business_id: context.businessId,
    period: context.period,
    status: context.status,
    approved_at: context.approvedAt,
    input_fingerprint: context.inputFingerprint,
    statement_fingerprint: context.statementFingerprint,
    payment:
      payment === null
        ? null
        : {
            paid_on: payment.paidOn,
            paid_method: payment.paidMethod,
            paid_note: payment.paidNote,
            paid_at: payment.paidAt,
            paid_by: payment.paidBy,
            paid_total: sumPaidAmounts(payment.payments.map((row) => row.paidAmount)),
            payments: paymentRows(payment, null),
          },
    employees,
  };
}
