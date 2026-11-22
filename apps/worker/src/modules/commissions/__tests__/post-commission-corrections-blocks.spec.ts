import { expect, it } from 'vitest';

import {
  type CommissionAttachmentInterval,
  type CommissionOpenBlock,
  type CommissionCorrectionDraft,
  type CommissionFrozenSource,
  type CommissionPostedCorrection,
  CommissionBlockNoticesMissingError,
  CommissionPeriodClosedError,
  type CommissionCorrectionCandidate,
  type CommissionBlockCodeUpdateInput,
  type CommissionBlockInsertInput,
  type CommissionBlockResolutionInput,
  type CommissionCorrectionInsertInput,
  type CommissionCorrectionScope,
  type CommissionMonthProjection,
  type CommissionMonthProjectionInput,
  type CommissionOpenBlockInput,
  postCommissionCorrections,
  selectCommissionCorrectionTargets,
} from '@pospay/commissions-posting';
import type { CommissionPeriodEmployee } from '../domain/commission-line-types.ts';
import { noCommissionBlockNotices } from './commission-block-notice.fakes.ts';
import { ProjectSalary } from '../use-cases/project-salary/project-salary.ts';
import {
  employeeA,
  FakeSalaryScope,
  monthProjection,
  salaryInput,
  salaryWorkedProjection,
} from './project-tip-salary-corrections.fakes.ts';

const clock = { now: () => new Date('2026-12-05T09:00:00Z') };
const ids = { newId: () => '01920000-0000-7000-8000-00000000ffff' };
const EVENT = 'event-a';
const employeeB = 'employee-b';
const projectionKey = (employeeId: string, period: string) => `${employeeId}:${period}`;

const line = (employeeId: string, period: string): CommissionMonthProjection['lines'][number] => ({
  employeeId,
  serviceId: 'service-a',
  branchId: 'branch-a',
  lineId: `line-${employeeId}-${period}`,
  occurredAt: 1n,
  recordedAt: 1n,
  businessDate: `${period}-10`,
  netShare: 100_000n,
  shareBps: 10_000n,
  counts: true,
  ruleSnapshot: { kind: 'FOLLOW_PLAN' },
  status: 'ACTIVE',
});

/** نطاق تصحيح بمسودات وإسقاطات لكل موظفة وشهر، عشان خطوة التوقف تتقاس لكل واحد فيهم. */
class PerKeyCorrections implements CommissionCorrectionScope {
  readonly calls: string[] = [];
  readonly blocks: CommissionBlockInsertInput[] = [];
  readonly codeUpdates: CommissionBlockCodeUpdateInput[] = [];
  readonly resolutions: CommissionBlockResolutionInput[] = [];
  readonly drafts: CommissionCorrectionDraft[] = [];
  readonly projections = new Map<string, CommissionMonthProjection>();
  readonly openBlocks = new Map<string, CommissionOpenBlock>();

  projection(employeeId: string, period: string, patch: Partial<CommissionMonthProjection> = {}) {
    this.projections.set(
      projectionKey(employeeId, period),
      monthProjection({ employeeId, period, ...patch }),
    );
  }

  async readMonthProjection(
    input: CommissionMonthProjectionInput,
  ): Promise<CommissionMonthProjection> {
    this.calls.push('readMonthProjection');
    const projection = this.projections.get(projectionKey(input.employeeId, input.period));
    if (projection === undefined) {
      throw new Error(`no test projection for ${projectionKey(input.employeeId, input.period)}`);
    }
    return projection;
  }
  async readOpenBlock(input: CommissionOpenBlockInput): Promise<CommissionOpenBlock | null> {
    this.calls.push('readOpenBlock');
    return this.openBlocks.get(projectionKey(input.employeeId, input.sourcePeriod)) ?? null;
  }
  async insertBlock(input: CommissionBlockInsertInput): Promise<string> {
    this.calls.push('insertBlock');
    this.blocks.push(input);
    return `block-${this.blocks.length}`;
  }
  async updateBlockCode(input: CommissionBlockCodeUpdateInput): Promise<void> {
    this.calls.push('updateBlockCode');
    this.codeUpdates.push(input);
  }
  async resolveBlock(input: CommissionBlockResolutionInput): Promise<void> {
    this.calls.push('resolveBlock');
    this.resolutions.push(input);
  }
  async bumpGeneration(): Promise<number> {
    this.calls.push('bumpGeneration');
    return 1;
  }
  async readFrozenSources(): Promise<readonly CommissionFrozenSource[]> {
    return [];
  }
  async readPostedCorrections(): Promise<readonly CommissionPostedCorrection[]> {
    return [];
  }
  async readAttachmentSnapshot(): Promise<readonly CommissionAttachmentInterval[]> {
    return [];
  }
  async insertCorrections(input: CommissionCorrectionInsertInput): Promise<void> {
    this.calls.push('insertCorrections');
    this.drafts.push(...input.drafts);
  }
}

const target = () => ({
  sourcePeriod: '2026-10',
  sourceStatementId: 'statement-oct',
  targetPeriod: '2026-11',
  targetStatementId: 'statement-nov',
});

const run = async (
  scope: CommissionCorrectionScope,
  employees: readonly CommissionPeriodEmployee[] = [{ period: '2026-10', employeeId: employeeA }],
): Promise<void> =>
  postCommissionCorrections({
    scope,
    businessId: 'business-a',
    companyId: 'company-a',
    eventId: EVENT,
    targets: [target()],
    employees,
    notices: noCommissionBlockNotices,
  });

it('U1 a NO_PLAN month records the block with the event id and the event target and posts nothing', async () => {
  const corrections = new PerKeyCorrections();
  corrections.projection(employeeA, '2026-10', {
    versions: [],
    lines: [line(employeeA, '2026-10')],
  });

  await run(corrections);

  expect(corrections.blocks).toEqual([
    {
      businessId: 'business-a',
      employeeId: employeeA,
      sourcePeriod: '2026-10',
      code: 'NO_PLAN',
      firstEventId: EVENT,
      targetPeriod: '2026-11',
      targetStatementId: 'statement-nov',
    },
  ]);
  expect(corrections.codeUpdates).toEqual([]);
  expect(corrections.resolutions).toEqual([]);
  expect(corrections.drafts).toEqual([]);
});

it('U2 an open block under a month whose code changed is updated by code only', async () => {
  const corrections = new PerKeyCorrections();
  corrections.projection(employeeA, '2026-10', { ...salaryWorkedProjection(), salaries: [] });
  corrections.openBlocks.set(projectionKey(employeeA, '2026-10'), {
    id: 'block-1',
    code: 'NO_PLAN',
  });

  await run(corrections);

  expect(corrections.codeUpdates).toEqual([{ blockId: 'block-1', code: 'NO_SALARY' }]);
  expect(corrections.blocks).toEqual([]);
  expect(corrections.resolutions).toEqual([]);
  expect(corrections.drafts).toEqual([]);
});

it('U3 an open block whose code matches the month writes nothing', async () => {
  const corrections = new PerKeyCorrections();
  corrections.projection(employeeA, '2026-10', {
    versions: [],
    lines: [line(employeeA, '2026-10')],
  });
  corrections.openBlocks.set(projectionKey(employeeA, '2026-10'), {
    id: 'block-1',
    code: 'NO_PLAN',
  });

  await run(corrections);

  expect(corrections.calls).toEqual(['bumpGeneration', 'readMonthProjection', 'readOpenBlock']);
  expect(corrections.blocks).toEqual([]);
  expect(corrections.codeUpdates).toEqual([]);
  expect(corrections.resolutions).toEqual([]);
  expect(corrections.drafts).toEqual([]);
});

it('U4 a priced month with an open block posts the corrections then resolves it with the new generation', async () => {
  const corrections = new PerKeyCorrections();
  corrections.projection(employeeA, '2026-10', { lines: [line(employeeA, '2026-10')] });
  corrections.openBlocks.set(projectionKey(employeeA, '2026-10'), {
    id: 'block-1',
    code: 'NO_PLAN',
  });

  await run(corrections);

  expect(corrections.drafts).toHaveLength(1);
  expect(corrections.drafts[0]).toMatchObject({
    employeeId: employeeA,
    sourcePeriod: '2026-10',
    targetPeriod: '2026-11',
    targetStatementId: 'statement-nov',
    sourceRef: `line:line-${employeeA}-2026-10`,
    amount: 10_000n,
    generation: 1,
    eventId: EVENT,
  });
  expect(corrections.resolutions).toEqual([{ blockId: 'block-1', generation: 1 }]);
  expect(corrections.blocks).toEqual([]);
  expect(corrections.calls.indexOf('insertCorrections')).toBeLessThan(
    corrections.calls.indexOf('resolveBlock'),
  );
});

it('U5 two employees in one event: the blocked one records and the other still posts', async () => {
  const corrections = new PerKeyCorrections();
  corrections.projection(employeeB, '2026-10', {
    versions: [],
    lines: [line(employeeB, '2026-10')],
  });
  corrections.projection(employeeA, '2026-10', { lines: [line(employeeA, '2026-10')] });

  await run(corrections, [
    { period: '2026-10', employeeId: employeeB },
    { period: '2026-10', employeeId: employeeA },
  ]);

  expect(corrections.blocks).toEqual([
    {
      businessId: 'business-a',
      employeeId: employeeB,
      sourcePeriod: '2026-10',
      code: 'NO_PLAN',
      firstEventId: EVENT,
      targetPeriod: '2026-11',
      targetStatementId: 'statement-nov',
    },
  ]);
  expect(corrections.resolutions).toEqual([]);
  expect(corrections.drafts).toHaveLength(1);
  expect(corrections.drafts[0]).toMatchObject({
    employeeId: employeeA,
    sourceRef: `line:line-${employeeA}-2026-10`,
    amount: 10_000n,
  });
});

it('U6 salary over two closed months: one records a block, the other posts, one lock call only', async () => {
  const scope = new FakeSalaryScope();
  scope.locked = [
    { period: '2026-10', statementId: 'statement-oct', status: 'APPROVED' },
    { period: '2026-11', statementId: 'statement-nov', status: 'APPROVED' },
    { period: '2026-12', statementId: 'statement-dec', status: 'DRAFT' },
  ];
  const corrections = new PerKeyCorrections();
  corrections.projection(employeeA, '2026-10', {
    versions: [],
    lines: [line(employeeA, '2026-10')],
  });
  corrections.projection(employeeA, '2026-11', { lines: [line(employeeA, '2026-11')] });

  await new ProjectSalary(scope, clock, ids, corrections, noCommissionBlockNotices).execute(
    salaryInput(),
  );

  expect(scope.lockInputs).toHaveLength(1);
  expect(scope.upserted).toMatchObject({ employeeId: employeeA, amount: 550_000n, revision: 2 });
  expect(corrections.blocks).toMatchObject([
    { employeeId: employeeA, sourcePeriod: '2026-10', code: 'NO_PLAN', targetPeriod: '2026-12' },
  ]);
  expect(corrections.resolutions).toEqual([]);
  expect(corrections.drafts).toHaveLength(1);
  expect(corrections.drafts[0]).toMatchObject({
    employeeId: employeeA,
    sourcePeriod: '2026-11',
    targetPeriod: '2026-12',
  });
  expect(scope.calls[scope.calls.length - 1]).toBe('reopenReviewed');
});

it('U7 a closed month with no DRAFT target still refuses before any write', () => {
  const locked: readonly CommissionCorrectionCandidate[] = [
    { period: '2026-10', statementId: 'statement-oct', status: 'APPROVED' },
    { period: '2026-11', statementId: 'statement-nov', status: 'APPROVED' },
    { period: '2026-12', statementId: 'statement-dec', status: 'APPROVED' },
  ];

  expect(() => selectCommissionCorrectionTargets(locked, ['2026-10'], '2026-12')).toThrowError(
    CommissionPeriodClosedError,
  );
});

const runWithoutNotices = (scope: CommissionCorrectionScope): Promise<void> =>
  postCommissionCorrections({
    scope,
    businessId: 'business-a',
    companyId: 'company-a',
    eventId: EVENT,
    targets: [target()],
    employees: [{ period: '2026-10', employeeId: employeeA }],
  });

it('U8 a caller with no notice writer still posts a priced month and resolves its open block', async () => {
  const corrections = new PerKeyCorrections();
  corrections.projection(employeeA, '2026-10', { lines: [line(employeeA, '2026-10')] });
  corrections.openBlocks.set(projectionKey(employeeA, '2026-10'), {
    id: 'block-1',
    code: 'NO_PLAN',
  });

  await runWithoutNotices(corrections);

  expect(corrections.resolutions).toEqual([{ blockId: 'block-1', generation: 1 }]);
  expect(corrections.blocks).toEqual([]);
});

it('U9 a caller with no notice writer refuses to record a new block instead of silently skipping the bell', async () => {
  const corrections = new PerKeyCorrections();
  corrections.projection(employeeA, '2026-10', {
    versions: [],
    lines: [line(employeeA, '2026-10')],
  });

  await expect(runWithoutNotices(corrections)).rejects.toBeInstanceOf(
    CommissionBlockNoticesMissingError,
  );
});
