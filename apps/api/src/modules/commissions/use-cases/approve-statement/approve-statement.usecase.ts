import {
  projectStatementView,
  statementFingerprintInput,
  type OpenBlockedCorrection,
  type StatementEmployeeLabel,
  type StatementBuild,
} from '@pospay/commissions-engine';
import type {
  CommissionClosedStatementBranchView,
  CommissionClosedStatementView,
} from '@pospay/contracts';
import { selectCommissionCorrectionTarget } from '@pospay/commissions-posting';

import {
  approvalBlockingIssues,
  incompleteLineShares,
  planApprovalCarries,
  type PlannedCarry,
} from '../../domain/approval-plan.ts';
import { coverageProofAdmits, isCoverageProofValid } from '../../domain/coverage-proof.ts';
import { CommissionPlanVersionError } from '../../domain/errors.ts';
import { periodsFromThrough } from '../../domain/period-range.ts';
import { statementChangeCause } from '../../domain/statement-change-cause.ts';
import { isStatementPeriodEnded } from '../../domain/statement-period.ts';
import type {
  CarryWrite,
  CommissionStatementApproveCommand,
  CommissionStatementApproveScope,
  CommissionStatementApproveTransactions,
} from '../../ports/commission-statement-approve.port.ts';
import type { FingerprintHasher } from '../../ports/fingerprint-hasher.port.ts';
import { employeeCarryBalances } from './carry-balances.ts';
import { closedStatementView } from '../compute-statement-view/closed-statement-view.ts';
import { departedEmployeeIds } from '../compute-statement-view/statement-view-contract.ts';
import { computeStatement } from '../compute-statement-view/compute-statement-view.ts';

const BUSINESS_WIDE = { businessWide: true, branchIds: [] as string[] } as const;

/** يعتمد كشف شهر REVIEWED: يتحقق ويجمّد صفوفه ومرحّلاته في معاملة واحدة، ويرجّع الكشف المغلق (FR-032). */
export class ApproveCommissionStatementUseCase {
  constructor(
    private readonly transactions: CommissionStatementApproveTransactions,
    private readonly hasher: FingerprintHasher,
  ) {}

  /**
   * @param command الفاعل والنشاط والشهر والبصمتان المتوقعتان ومفتاح إعادة الإرسال
   * @returns الكشف المغلق من صفوفه المجمّدة
   */
  execute(
    command: CommissionStatementApproveCommand,
  ): Promise<CommissionClosedStatementView | CommissionClosedStatementBranchView> {
    return this.transactions.run(command, (scope) => approveStatement(scope, command, this.hasher));
  }
}

/**
 * يرمي رفضًا بكود وتفاصيل.
 *
 * @param code كود الرفض
 * @param details تفاصيل اختيارية تظهر في الرد
 */
function refuse(
  code: ConstructorParameters<typeof CommissionPlanVersionError>[0],
  details?: unknown,
): never {
  throw new CommissionPlanVersionError(code, details);
}

/**
 * يرفض كل حالة غير REVIEWED: معتمد أو مصروف 409 CLOSED، وغيرهما (مسودة أو كشف لم يُنشأ) 409 NOT_REVIEWED. يُستدعى مرتين:
 * قبل أي قفل بقراءة بلا قفل، فطلب لشهر قديم جدًا لا ينتج صف قفل لكل شهر حتى اليوم، ثم بعد القفل على الحالة التي تراها
 * المعاملة بعد الانتظار.
 *
 * @param status حالة الكشف، أو null لو لا كشف
 */
function assertReviewable(status: string | null): void {
  if (status === 'APPROVED' || status === 'PAID') refuse('COMMISSION_PERIOD_CLOSED');
  if (status !== 'REVIEWED') refuse('COMMISSION_STATEMENT_NOT_REVIEWED');
}

/**
 * ترتيب الاعتماد بالظبط كما في ADR-0054 §7: لحظة البداية أولًا، ثم اليوم المحلي وانتهاء الشهر، ثم قفل واحد
 * تصاعدي، ثم إعادة الصلاحية والحالة، ثم بوابة التغطية (مفتاح الاعتماد 403 ثم الإثبات 422)، ثم البصمتان
 * والمشاكل المانعة وD-14، ثم العدّاد (409 أخيرًا)، ثم التحديث الواحد والتجميد وبصمة الكشف المعادة وكتابة
 * المرحّلات والتدقيق. أي رفض بعد القفل يلغي المعاملة كلها.
 *
 * @param scope خطوات المعاملة
 * @param command الفاعل والطلب
 * @param hasher منفذ التجزئة
 * @returns الكشف المغلق من الصفوف المجمّدة وحدها
 */
export async function approveStatement(
  scope: CommissionStatementApproveScope,
  command: CommissionStatementApproveCommand,
  hasher: FingerprintHasher,
): Promise<CommissionClosedStatementView | CommissionClosedStatementBranchView> {
  const { period, businessId } = command;
  const cutoff = await scope.cutoff();
  const today = await scope.localToday();
  if (today === null) refuse('FORBIDDEN');
  if (!isStatementPeriodEnded(period, today)) refuse('COMMISSION_PERIOD_NOT_ENDED');
  const currentPeriod = today.slice(0, 7);
  assertReviewable(await scope.readStatementStatus(period));
  const locked = await scope.lockPeriods(periodsFromThrough(period, currentPeriod));
  const failure = await scope.recheckAccess();
  if (failure !== null) refuse(failure);
  const statement = locked.find((candidate) => candidate.period === period);
  if (statement === undefined) throw new Error('The locked periods do not include the statement');
  assertReviewable(statement.status);

  await passCoverageGate(scope, businessId, period);

  const source = await scope.readSource(period);
  const computed = computeStatement(period, source, hasher);
  assertFingerprintsCurrent(command, source.statement, computed);
  assertNoBlockers(source, computed.build);
  const incomplete = incompleteLineShares(await scope.readLineShares(period));
  if (incomplete.length > 0)
    refuse('COMMISSION_STATEMENT_BLOCKED', { issues: [], line_ids: incomplete });
  if ((await scope.countPendingEvents(cutoff)) > 0) refuse('COMMISSION_UPDATES_PENDING');

  const rows = computed.build.rows;
  const employeeIds = [...new Set(rows.map((row) => row.employeeId))].sort();
  const carries = planApprovalCarries(
    period,
    employeeCarryBalances(rows),
    await scope.readEmployment(employeeIds),
  );
  const target = selectCommissionCorrectionTarget(locked, period, currentPeriod);
  if (carries.length > 0 && target === null)
    throw new Error('No open month can receive the carries');

  return freezeApproval(
    scope,
    {
      businessId,
      period,
      statementId: statement.statementId,
      computed,
      carries,
      target,
      departed: departedEmployeeIds(source),
    },
    hasher,
  );
}

interface FreezeInput {
  readonly businessId: string;
  readonly period: string;
  readonly statementId: string;
  readonly computed: ReturnType<typeof computeStatement>;
  readonly carries: readonly PlannedCarry[];
  readonly target: { readonly period: string; readonly statementId: string } | null;
  /** من سابت الشغل قبل الشهر، من المصادر الحية، لعلامة الرد فقط (CM-50). */
  readonly departed: ReadonlySet<string>;
}

/**
 * الجزء الكاتب من الاعتماد بعد اجتياز كل الفحوص: تحديث واحد إلى APPROVED ثم التجميد، ثم إعادة حساب بصمة الكشف من
 * الصفوف المجمّدة نفسها ومقارنتها (أي اختلاف يلغي المعاملة كلها)، ثم المرحّلات والتدقيق، والرد من المجمّد وحده.
 *
 * @param scope خطوات المعاملة
 * @param input الكشف والبصمتان المحسوبتان والمرحّلات وهدفها
 * @param hasher منفذ التجزئة
 * @returns الكشف المغلق من الصفوف المجمّدة وحدها
 */
async function freezeApproval(
  scope: CommissionStatementApproveScope,
  input: FreezeInput,
  hasher: FingerprintHasher,
): Promise<CommissionClosedStatementView | CommissionClosedStatementBranchView> {
  const { businessId, period, statementId, computed, carries, target } = input;
  const rows = computed.build.rows;
  await scope.markApproved({
    statementId,
    inputFingerprint: computed.inputFingerprint,
    statementFingerprint: computed.statementFingerprint,
  });
  await scope.freeze(statementId, rows, computed.build.attachments);
  const frozen = await scope.readFrozen(statementId);
  const frozenFingerprint = hasher.hash(statementFingerprintInput(frozen.rows, frozen.attachments));
  if (frozenFingerprint !== computed.statementFingerprint) {
    refuse('COMMISSION_FINGERPRINT_STALE', staleDetails(computed, 'STATEMENT'));
  }
  if (carries.length > 0 && target === null) throw new Error('No open month can receive the carries');
  const writes: CarryWrite[] =
    target === null
      ? []
      : carries.map((carry) => ({
          ...carry,
          targetPeriod: target.period,
          targetStatementId: target.statementId,
        }));
  await scope.writeCarries(statementId, period, writes);
  await scope.audit(statementId, period, {
    inputFingerprint: computed.inputFingerprint,
    statementFingerprint: computed.statementFingerprint,
    rows: frozen.rows.length,
    carries: writes.length,
  });
  return closedStatementView({
    businessId,
    period,
    status: 'APPROVED',
    approvedAt: await scope.readApprovedAt(statementId),
    inputFingerprint: computed.inputFingerprint,
    statementFingerprint: computed.statementFingerprint,
    rows: frozen.rows,
    payment: null,
    scope: BUSINESS_WIDE,
    departed: input.departed,
  });
}

/**
 * بوابة التغطية تحت قفل صف الحالة: مفتاح الاعتماد الصريح أولًا (مغلق = 403 FEATURE_DISABLED)، ثم صلاحية
 * الإثبات ونطاقه (422)؛ العدّاد يأتي بعدهما وآخرهما 409 (ADR-0054 §7 الخطوة 5).
 *
 * @param scope خطوات المعاملة
 * @param businessId النشاط
 * @param period الشهر
 */
async function passCoverageGate(
  scope: CommissionStatementApproveScope,
  businessId: string,
  period: string,
): Promise<void> {
  const gate = await scope.readCoverageGate();
  if (!gate.switchEnabled) refuse('FEATURE_DISABLED');
  const { proof, expected } = gate;
  if (
    proof === null ||
    !isCoverageProofValid(proof, expected) ||
    !coverageProofAdmits(proof, businessId, period)
  ) {
    refuse('COMMISSION_COVERAGE_NOT_PROVEN');
  }
}

/**
 * تفاصيل رفض البصمة القديمة: البصمتان الحاليتان وسبب التغيّر، و`return_required` لأن الكشف REVIEWED فالشاشة
 * تعرض الرجوع للمسودة بدل إعادة محاولة ستفشل بنفس الشكل (FR-031، CM-32b).
 *
 * @param computed البصمتان الحاليتان
 * @param changed سبب التغيّر
 * @returns تفاصيل الخطأ
 */
function staleDetails(
  computed: { readonly inputFingerprint: string; readonly statementFingerprint: string },
  changed: 'INPUTS' | 'STATEMENT',
): object {
  return {
    current_fingerprint: computed.inputFingerprint,
    current_statement_fingerprint: computed.statementFingerprint,
    changed,
    return_required: true,
  };
}

/**
 * يقارن البصمتين الحاليتين ببصمتي المراجعة المخزّنتين وببصمتي طلب العميل؛ أي اختلاف رفض مبكر قبل أي تجميد
 * (FR-032). السبب `INPUTS` لو اختلفت المدخلات، وإلا `STATEMENT`.
 *
 * @param command الطلب بالبصمتين المتوقعتين
 * @param statement صف الكشف المخزّن
 * @param computed البصمتان الحاليتان
 */
function assertFingerprintsCurrent(
  command: CommissionStatementApproveCommand,
  statement: {
    reviewedFingerprint: string | null;
    reviewedStatementFingerprint: string | null;
  } | null,
  computed: { readonly inputFingerprint: string; readonly statementFingerprint: string },
): void {
  const current = { input: computed.inputFingerprint, statement: computed.statementFingerprint };
  const reviewed = {
    input: statement?.reviewedFingerprint ?? '',
    statement: statement?.reviewedStatementFingerprint ?? '',
  };
  const expected = {
    input: command.expectedFingerprint,
    statement: command.expectedStatementFingerprint,
  };
  const cause = statementChangeCause(reviewed, current) ?? statementChangeCause(expected, current);
  if (cause !== null) refuse('COMMISSION_FINGERPRINT_STALE', staleDetails(computed, cause));
}

/**
 * يرفض لو في أي مشكلة مانعة: فشل تسعير أو تصحيح موقوف مفتوح، من نفس إسقاط الكشف الذي يراه المراجع (FR-027).
 *
 * @param source مصادر الكشف
 * @param build ناتج الباني
 */
function assertNoBlockers(
  source: {
    readonly blocked: readonly OpenBlockedCorrection[];
    readonly unlisted: readonly StatementEmployeeLabel[];
  },
  build: StatementBuild,
): void {
  const employees = projectStatementView({
    rows: build.rows,
    failures: build.failures,
    blocked: source.blocked,
    unlisted: source.unlisted,
    scope: BUSINESS_WIDE,
  });
  const issues = approvalBlockingIssues(employees);
  if (issues.length > 0) {
    refuse('COMMISSION_STATEMENT_BLOCKED', {
      issues: issues.map((issue) => ({ employee_id: issue.employeeId, code: issue.code })),
    });
  }
}
