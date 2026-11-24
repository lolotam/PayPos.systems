import { expect, it } from 'vitest';

import type {
  CoverageIssuanceDependencies,
  CoverageReportIdentity,
} from '../../ports/coverage-issuance.port.ts';
import type { CommissionCoverageReport } from '../report-commission-coverage/report-commission-coverage.ts';
import { issueCommissionCoverage } from './issue-commission-coverage.ts';

const identity: CoverageReportIdentity = {
  databaseName: 'synthetic',
  systemId: '123',
  version: 1,
  tipBound: '2026-11-25',
};
const input = {
  scope: {
    companyId: 'company',
    throughId: null,
    tips: { businessIds: ['a', 'b'], from: '2026-01-01', to: identity.tipBound },
  },
  stateId: 'state',
  proofId: 'proof',
  runId: 'run',
  release: 'test',
  dryRun: false,
};

function report(): CommissionCoverageReport {
  const section = () => ({
    checked: 0,
    missing: { total: 0, ids: [] },
    stale: { total: 0, ids: [] },
  });
  return {
    status: 'COVERED',
    throughId: null,
    tipScope: input.scope.tips,
    tipsNote: null,
    truncated: false,
    lines: section(),
    salaries: section(),
    sales: section(),
    tips: section(),
    unmarked: { checked: 0, total: 0, events: [] },
    notHandled: { total: 0, events: [] },
  };
}

function dependencies() {
  // بديل حدود I/O فقط: النتيجة تظهر الإصدار الفعلي أو غيابه، لا نعدّ استدعاءات دوال داخلية.
  const proofs: unknown[] = [];
  const issuer: CoverageIssuanceDependencies['issuer'] = {
    verifyAndIssue: async (_company, _state, verify) => {
      const checked = await verify({ ...identity, generation: '7' });
      if (checked.proof !== null) proofs.push(checked.proof);
      return { result: checked.result, generation: checked.proof === null ? null : '8' };
    },
    close: async () => undefined,
  };
  const deps: CoverageIssuanceDependencies & { report(): Promise<CommissionCoverageReport> } = {
    issuer,
    identity: async () => identity,
    businessIds: async () => ['a', 'b'],
    withTenant: async (_company, fn) =>
      fn({} as Parameters<Parameters<CoverageIssuanceDependencies['withTenant']>[1]>[0]),
    tips: { existsAfter: async () => false },
    report: async () => report(),
  };
  return { deps, proofs };
}

it('checks every business and issues the exact reported bounds; dry-run never issues', async () => {
  const { deps, proofs } = dependencies();
  const result = await issueCommissionCoverage(deps, input);
  expect(result).toMatchObject({
    generation: '8',
    result: { tipBound: identity.tipBound, version: 1 },
  });
  expect(proofs).toEqual([
    {
      proofId: 'proof',
      version: 1,
      businessIds: ['a', 'b'],
      tipFrom: '2026-01-01',
      tipTo: identity.tipBound,
      throughId: null,
      runId: 'run',
      release: 'test',
    },
  ]);
  const dry = dependencies();
  expect(
    (await issueCommissionCoverage(dry.deps, { ...input, dryRun: true })).generation,
  ).toBeNull();
  expect(dry.proofs).toEqual([]);
});

it.each([
  'database',
  'version',
  'scope',
  'report',
  'tips',
  'unknown-business',
  'reader-error',
] as const)('refuses %s without issuing', async (failure) => {
  const { deps, proofs } = dependencies();
  if (failure === 'database') deps.identity = async () => ({ ...identity, systemId: 'other' });
  if (failure === 'version') deps.identity = async () => ({ ...identity, version: 2 });
  if (failure === 'scope') deps.businessIds = async () => ['a', 'b', 'c'];
  if (failure === 'report') deps.report = async () => ({ ...report(), status: 'NOT_COVERED' });
  if (failure === 'tips')
    deps.tips.existsAfter = async (_tx, _company, business) => business === 'b';
  if (failure === 'unknown-business' || failure === 'reader-error')
    deps.tips.existsAfter = async () => {
      throw new Error(
        failure === 'unknown-business' ? 'COVERAGE_SCOPE_INCOMPLETE' : 'untrusted read',
      );
    };
  await expect(issueCommissionCoverage(deps, input)).rejects.toThrow();
  expect(proofs).toEqual([]);
});

it('midnight wins over a tip on the new bound day; the application clock is never consulted', async () => {
  const { deps, proofs } = dependencies();
  let reads = 0;
  deps.identity = async () => ({
    ...identity,
    tipBound: reads++ === 0 ? identity.tipBound : '2026-11-26',
  });
  deps.tips.existsAfter = async () => true;
  await expect(issueCommissionCoverage(deps, input)).rejects.toThrow('COVERAGE_TIP_BOUND_MOVED');
  expect(proofs).toEqual([]);
});
