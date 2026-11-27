import {
  projectStatementView,
  type StatementSourceRow,
  type StatementViewEmployee,
  type StatementViewScope,
} from '@pospay/commissions-engine';
import type {
  CommissionStatementBranchView,
  CommissionStatementEmployee,
  CommissionStatementRow,
  CommissionStatementView,
} from '@pospay/contracts';

import { statementChangeCause } from '../../domain/statement-change-cause.ts';
import type { CommissionStatementSource } from '../../ports/commission-statement.port.ts';
import type { ComputedStatement } from './compute-statement-view.ts';

/** صف الكشف بشكل العقد؛ المعرّفات الداخلية (الجلسة والبند) ما بتخرجش، والعميل باسمه الكامل من غير تليفون. */
function rowContract(row: StatementSourceRow): CommissionStatementRow {
  return {
    source_ref: row.sourceRef,
    kind: row.kind,
    amount: row.amount,
    previous_amount: row.previousAmount,
    new_amount: row.newAmount,
    source_period: row.sourcePeriod,
    source_branch_id: row.sourceBranchId,
    source_branch_name_ar: row.sourceBranchNameAr,
    source_branch_name_en: row.sourceBranchNameEn,
    source_business_date: row.sourceBusinessDate,
    service_name_ar: row.serviceNameAr,
    service_name_en: row.serviceNameEn,
    customer_name: row.customerName,
    business_date: row.businessDate,
  };
}

/**
 * نص مجموع موظفة بثلاث منازل. مجموع صفوف كثيرة قد يتخطى حد `numeric(14,3)` الذي يفرضه `moneyToString` على المبلغ الواحد،
 * فالتنسيق هنا بلا ذلك الحد؛ حدّ المجموع في العقد (16 خانة صحيحة) والتحقق منه داخل المعاملة قبل الالتزام.
 *
 * @param mills المجموع بالفلس، موجبًا أو سالبًا
 * @returns المجموع بالدينار كنص بثلاث منازل
 */
function totalToString(mills: bigint): string {
  const sign = mills < 0n ? '-' : '';
  const abs = mills < 0n ? -mills : mills;
  return `${sign}${abs / 1000n}.${(abs % 1000n).toString().padStart(3, '0')}`;
}

/** موظفة الكشف بشكل العقد، مجاميعها من صفوفها المرئية. */
export function employeeContract(employee: StatementViewEmployee): CommissionStatementEmployee {
  return {
    employee_id: employee.employeeId,
    employee_number: employee.employeeNumber,
    name_ar: employee.nameAr,
    name_en: employee.nameEn,
    partial: employee.partial,
    departed: employee.departed,
    commission_subtotal: totalToString(employee.payable.commissionSubtotal),
    tip_side: totalToString(employee.payable.tipSide),
    payable: totalToString(employee.payable.payable),
    rows: employee.rows.map(rowContract),
    issues: employee.issues.map((issue) => ({
      kind: issue.kind,
      code: issue.code,
      source_period: issue.sourcePeriod,
    })),
  };
}

/**
 * معرّفات الموظفات اللي سابت الشغل قبل الشهر، من بطاقات مصادر الكشف الحية (CM-50). العلامة مش مخزّنة في
 * الصفوف المجمّدة، فالكشف المغلق كمان بيقراها من هنا.
 *
 * @param source مصادر الكشف الحية
 * @returns مجموعة معرّفات من سابت الشغل
 */
export function departedEmployeeIds(
  source: Pick<CommissionStatementSource, 'employees' | 'unlisted'>,
): ReadonlySet<string> {
  return new Set(
    [...source.employees, ...source.unlisted]
      .filter((label) => label.departed === true)
      .map((label) => label.employeeId),
  );
}

/** ما بيلزم لبناء الردّين: الكشف المحسوب ومصادره ونطاق القارئ. */
interface StatementViewContext {
  readonly businessId: string;
  readonly period: string;
  readonly source: CommissionStatementSource;
  readonly computed: ComputedStatement;
  readonly scope: StatementViewScope;
}

/** الحالة المفتوحة للكشف: DRAFT لو الشهر ما اتكتبش له صف. المغلق مرفوض قبل الوصول هنا. */
function openStatus(source: CommissionStatementSource): 'DRAFT' | 'REVIEWED' {
  return source.statement?.status === 'REVIEWED' ? 'REVIEWED' : 'DRAFT';
}

/** هل الكشف اتولّد قبل كده: بصمة المدخلات المخزّنة موجودة (research R6). */
function isGenerated(source: CommissionStatementSource): boolean {
  return source.statement?.currentFingerprint != null;
}

/**
 * رد قارئ على مستوى النشاط: البصمتان الحاليتان وبصمتا المراجعة وعلم التغيّر وسببه (FR-025). التغيّر
 * بيتقاس بس لكشف REVIEWED، من البصمتين المراجعتين مقابل اللي بيطلعوا دلوقتي.
 *
 * @param context الكشف المحسوب ومصادره
 * @returns رد النشاط كله
 */
export function businessViewContract(context: StatementViewContext): CommissionStatementView {
  const { source, computed } = context;
  const reviewed = source.statement?.reviewedFingerprint ?? null;
  const reviewedStatement = source.statement?.reviewedStatementFingerprint ?? null;
  const cause =
    openStatus(source) === 'REVIEWED' && reviewed !== null && reviewedStatement !== null
      ? statementChangeCause(
          { input: reviewed, statement: reviewedStatement },
          { input: computed.inputFingerprint, statement: computed.statementFingerprint },
        )
      : null;
  return {
    reader_scope: 'BUSINESS',
    business_id: context.businessId,
    period: context.period,
    status: openStatus(source),
    generated: isGenerated(source),
    current_fingerprint: computed.inputFingerprint,
    current_statement_fingerprint: computed.statementFingerprint,
    reviewed_fingerprint: reviewed,
    reviewed_statement_fingerprint: reviewedStatement,
    changed_since_review: cause !== null,
    change_cause: cause,
    employees: projectEmployees(context),
  };
}

/**
 * رد قارئ الفروع: الحالة وصفوفه المرئية بس، من غير أي حقل على الكشف كله (FR-025، CM-28c).
 *
 * @param context الكشف المحسوب ومصادره
 * @returns رد الفروع
 */
export function branchViewContract(context: StatementViewContext): CommissionStatementBranchView {
  return {
    reader_scope: 'BRANCHES',
    business_id: context.businessId,
    period: context.period,
    status: openStatus(context.source),
    generated: isGenerated(context.source),
    employees: projectEmployees(context),
  };
}

/** الموظفات المرئيات للقارئ بشكل العقد. */
function projectEmployees(context: StatementViewContext): CommissionStatementEmployee[] {
  return projectStatementView({
    rows: context.computed.build.rows,
    failures: context.computed.build.failures,
    blocked: context.source.blocked,
    unlisted: context.source.unlisted,
    scope: context.scope,
    departed: departedEmployeeIds(context.source),
  }).map(employeeContract);
}
