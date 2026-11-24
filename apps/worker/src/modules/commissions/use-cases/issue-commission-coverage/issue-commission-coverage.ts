import { COMMISSION_COVERAGE_PROOF_VERSION } from '@pospay/domain';

import {
  assertIssuableCoverage,
  assertSamePrimary,
  CoverageProofRefused,
} from '../../domain/coverage-issuance.ts';
import type { CoverageIssuanceDependencies } from '../../ports/coverage-issuance.port.ts';
import type {
  CommissionCoverageReport,
  CommissionCoverageScope,
} from '../report-commission-coverage/report-commission-coverage.ts';

/** طلب إصدار من تقرير جديد داخل العملية نفسها؛ المعرّفات مولّدة في جذر الأمر. */
export interface IssueCommissionCoverageInput {
  readonly scope: CommissionCoverageScope;
  readonly stateId: string;
  readonly proofId: string;
  readonly runId: string;
  readonly release: string;
  readonly dryRun: boolean;
}

/** تقرير ثم تحقق وجود ثم إصدار؛ الرفض لا يصل أبداً إلى دالة الإصدار. */
export async function issueCommissionCoverage(
  deps: CoverageIssuanceDependencies & {
    report(scope: CommissionCoverageScope): Promise<CommissionCoverageReport>;
  },
  input: IssueCommissionCoverageInput,
) {
  return deps.issuer.verifyAndIssue(input.scope.companyId, input.stateId, async (snapshot) => {
    const identity = await deps.identity(input.scope.companyId);
    assertSamePrimary(identity, snapshot);
    if (identity.version !== COMMISSION_COVERAGE_PROOF_VERSION)
      throw new CoverageProofRefused('COVERAGE_VERSION_REFUSED');
    const businesses = await deps.withTenant(input.scope.companyId, (tx) =>
      deps.businessIds(tx, input.scope.companyId),
    );
    if (
      businesses.length === 0 ||
      JSON.stringify([...businesses].sort()) !==
        JSON.stringify([...(input.scope.tips?.businessIds ?? [])].sort())
    )
      throw new CoverageProofRefused('COVERAGE_SCOPE_INCOMPLETE');
    const report = await deps.report(input.scope);
    assertIssuableCoverage(report);
    const scope = report.tipScope;
    if (scope === null || scope.to < snapshot.tipBound)
      throw new CoverageProofRefused('COVERAGE_SCOPE_INCOMPLETE');
    await verifyTips(deps, input.scope.companyId, scope.businessIds, snapshot.tipBound);
    return {
      result: {
        status: input.dryRun ? 'DRY_RUN_COVERED' : 'ISSUED',
        reportThroughId: report.throughId,
        tipFrom: scope.from,
        tipTo: scope.to,
        tipBound: snapshot.tipBound,
        version: COMMISSION_COVERAGE_PROOF_VERSION,
        expectedGeneration: snapshot.generation,
        businessIds: scope.businessIds,
      },
      proof: input.dryRun
        ? null
        : {
            proofId: input.proofId,
            version: COMMISSION_COVERAGE_PROOF_VERSION,
            businessIds: scope.businessIds,
            tipFrom: scope.from,
            tipTo: scope.to,
            throughId: report.throughId,
            runId: input.runId,
            release: input.release,
          },
    };
  });
}

async function verifyTips(
  deps: CoverageIssuanceDependencies,
  companyId: string,
  businessIds: readonly string[],
  bound: string,
): Promise<void> {
  let tipFailure: unknown;
  try {
    for (const businessId of businessIds) {
      const exists = await deps.withTenant(companyId, (tx) =>
        deps.tips.existsAfter(tx, companyId, businessId, bound),
      );
      if (exists !== false) throw new CoverageProofRefused('COVERAGE_TIPS_AFTER_BOUND');
    }
  } catch (error) {
    tipFailure = error;
  }
  // انتقال اليوم أسبق من رفض الوجود، لكن الخطأ الأصلي يعاد لو ظل الحد ثابتاً؛ لا يُبلع فشل القراءة.
  if ((await deps.identity(companyId)).tipBound !== bound)
    throw new CoverageProofRefused('COVERAGE_TIP_BOUND_MOVED');
  if (tipFailure !== undefined) throw tipFailure;
}
