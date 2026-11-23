import {
  projectStatementView,
  type StatementRow,
  type StatementViewScope,
} from '@pospay/commissions-engine';
import type {
  CommissionClosedStatementBranchView,
  CommissionClosedStatementView,
} from '@pospay/contracts';

import { employeeContract } from './statement-view-contract.ts';

/** ما يلزم لرد الكشف المغلق: صفوفه المجمّدة وبيانات اعتماده المخزّنة ونطاق القارئ. */
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
  readonly scope: StatementViewScope;
}

/**
 * يبني رد الكشف المغلق من صفوفه المجمّدة وحدها (FR-025، FR-033): مفيش حساب حي ولا مصدر خارج
 * `commission_statement_lines`. قارئ النشاط كله بياخد البصمتين المجمّدتين، وقارئ الفروع بياخد صفوفه المرئية
 * بس حسب `attachedBranchIds` المجمّدة من غير أي حقل على الكشف كله (CM-28c).
 *
 * @param context الصفوف المجمّدة وبيانات الاعتماد والنطاق
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
  if (!context.scope.businessWide) {
    return {
      reader_scope: 'BRANCHES',
      business_id: context.businessId,
      period: context.period,
      status: context.status,
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
    employees,
  };
}
