import { expect, it } from 'vitest';

import type { CommissionAttachmentInterval } from '../domain/commission-correction-attribution.ts';
import type {
  CommissionCorrectionDraft,
  CommissionFrozenSource,
  CommissionPostedCorrection,
} from '../domain/commission-correction-step.ts';
import type {
  CommissionLineEventInput,
  CommissionLinePerformerPeriod,
  CommissionLineSnapshot,
  HeldCommissionLineHead,
  LockedCommissionPeriod,
} from '../domain/commission-line-types.ts';
import type {
  CommissionMonthProjection,
  CommissionCorrectionScope,
  CommissionCorrectionInsertInput,
  CommissionBlockInsertInput,
  CommissionBlockCodeUpdateInput,
  CommissionBlockResolutionInput,
} from '../ports/commission-correction.port.ts';
import type {
  CommissionLineProjectionScope,
  CommissionLineReplacement,
  CommissionPeriodLockInput,
  CommissionPeriodReopenInput,
} from '../ports/commission-line-projection.port.ts';
import { ProjectServiceLines } from '../use-cases/project-service-lines/project-service-lines.ts';
import { noCommissionBlockNotices } from './commission-block-notice.fakes.ts';
import type { CommissionOpenBlock } from '../domain/commission-blocked-correction.ts';

const line = (patch: Partial<CommissionLineSnapshot> = {}): CommissionLineSnapshot => ({
  lineId: 'line-a',
  sessionId: 'session-a',
  businessId: 'business-a',
  branchId: 'branch-a',
  serviceId: 'service-a',
  customerId: 'customer-a',
  status: 'ACTIVE',
  occurredAt: '2026-10-01T09:00:00Z',
  recordedAt: '2026-10-01T09:00:00Z',
  businessDate: '2026-10-01',
  net: '10.001',
  performers: [{ employeeId: 'employee-a', shareBps: 10000 }],
  ruleSnapshot: { kind: 'FOLLOW_PLAN' },
  countsSnapshot: true,
  revision: 2,
  ...patch,
});

const input = (lines: readonly CommissionLineSnapshot[]): CommissionLineEventInput => ({
  companyId: 'company-a',
  businessId: 'business-a',
  sessionId: 'session-a',
  eventId: 'event-a',
  lines,
});

class FakeScope implements CommissionLineProjectionScope {
  readonly calls: string[] = [];
  readonly replacements: CommissionLineReplacement[] = [];
  readonly lockInputs: CommissionPeriodLockInput[] = [];
  heads: readonly HeldCommissionLineHead[] = [];
  locked: readonly LockedCommissionPeriod[] = [];
  performers: readonly CommissionLinePerformerPeriod[] = [];
  reopenInput: CommissionPeriodReopenInput | undefined;

  async lockLines(): Promise<void> {
    this.calls.push('lockLines');
  }
  async readHeads(): Promise<readonly HeldCommissionLineHead[]> {
    this.calls.push('readHeads');
    return this.heads;
  }
  async businessTimeZone(): Promise<string | null> {
    this.calls.push('businessTimeZone');
    return 'Asia/Kuwait';
  }
  async lockPeriods(input: CommissionPeriodLockInput): Promise<readonly LockedCommissionPeriod[]> {
    this.calls.push('lockPeriods');
    this.lockInputs.push(input);
    return this.locked;
  }
  async readLinePerformers(): Promise<readonly CommissionLinePerformerPeriod[]> {
    this.calls.push('readLinePerformers');
    return this.performers;
  }
  async replaceLines(replacements: readonly CommissionLineReplacement[]): Promise<void> {
    this.calls.push('replaceLines');
    this.replacements.push(...replacements);
  }
  async reopenReviewed(input: CommissionPeriodReopenInput): Promise<void> {
    this.calls.push('reopenReviewed');
    this.reopenInput = input;
  }
}

const plan = (): CommissionMonthProjection['versions'][number] => ({
  employeeId: 'employee-a',
  effectiveFrom: '2026-10-01',
  wholePeriod: false,
  repairPeriod: null,
  createdAt: 1n,
  version: 1n,
  base: { enabled: true, calc: { kind: 'PCT', value: 1000n } },
  tiers: { enabled: false },
  packageSale: { enabled: false },
});

const monthProjection = (
  patch: Partial<CommissionMonthProjection> = {},
): CommissionMonthProjection => ({
  employeeId: 'employee-a',
  period: '2026-10',
  lines: [
    {
      employeeId: 'employee-a',
      branchId: 'branch-a',
      serviceId: 'service-a',
      lineId: 'line-a',
      occurredAt: 1n,
      recordedAt: 1n,
      businessDate: '2026-10-01',
      netShare: 10_001n,
      shareBps: 10_000n,
      counts: true,
      ruleSnapshot: { kind: 'FOLLOW_PLAN' },
      status: 'ACTIVE',
    },
  ],
  sales: [],
  salaries: [],
  versions: [plan()],
  overrides: [],
  tips: [],
  corrections: [],
  ...patch,
});

class FakeCorrections implements CommissionCorrectionScope {
  projection = monthProjection();
  frozen: readonly CommissionFrozenSource[] = [];
  posted: readonly CommissionPostedCorrection[] = [];
  attachments: readonly CommissionAttachmentInterval[] = [];
  readonly drafts: CommissionCorrectionDraft[] = [];
  openBlock: CommissionOpenBlock | null = null;
  readonly insertedBlocks: CommissionBlockInsertInput[] = [];
  readonly codeUpdates: CommissionBlockCodeUpdateInput[] = [];
  readonly resolutions: CommissionBlockResolutionInput[] = [];

  constructor(private readonly calls: string[]) {}

  async bumpGeneration(): Promise<number> {
    this.calls.push('bumpGeneration');
    return 1;
  }
  async readMonthProjection(): Promise<CommissionMonthProjection> {
    this.calls.push('readMonthProjection');
    return this.projection;
  }
  async readFrozenSources(): Promise<readonly CommissionFrozenSource[]> {
    this.calls.push('readFrozenSources');
    return this.frozen;
  }
  async readPostedCorrections(): Promise<readonly CommissionPostedCorrection[]> {
    this.calls.push('readPostedCorrections');
    return this.posted;
  }
  async readAttachmentSnapshot(): Promise<readonly CommissionAttachmentInterval[]> {
    this.calls.push('readAttachmentSnapshot');
    return this.attachments;
  }
  async insertCorrections(input: CommissionCorrectionInsertInput): Promise<void> {
    this.calls.push('insertCorrections');
    this.drafts.push(...input.drafts);
  }
  async readOpenBlock(): Promise<CommissionOpenBlock | null> {
    this.calls.push('readOpenBlock');
    return this.openBlock;
  }
  async insertBlock(input: CommissionBlockInsertInput): Promise<string> {
    this.calls.push('insertBlock');
    this.insertedBlocks.push(input);
    return 'block-1';
  }
  async updateBlockCode(input: CommissionBlockCodeUpdateInput): Promise<void> {
    this.calls.push('updateBlockCode');
    this.codeUpdates.push(input);
  }
  async resolveBlock(input: CommissionBlockResolutionInput): Promise<void> {
    this.calls.push('resolveBlock');
    this.resolutions.push(input);
  }
}

const clock = { now: () => new Date('2026-12-05T09:00:00Z') };
const ids = { newId: () => '01920000-0000-7000-8000-00000000ffff' };

it('posts a late line correction with projected attribution using one period lock', async () => {
  const scope = new FakeScope();
  scope.heads = [{ ...line({ revision: 1 }), period: '2026-10' }];
  scope.performers = [{ lineId: 'line-a', employeeId: 'employee-a', period: '2026-10' }];
  scope.locked = [
    { period: '2026-10', statementId: 'statement-oct', status: 'APPROVED' },
    { period: '2026-11', statementId: 'statement-nov', status: 'DRAFT' },
    { period: '2026-12', statementId: 'statement-dec', status: 'DRAFT' },
  ];
  const corrections = new FakeCorrections(scope.calls);
  corrections.attachments = [
    { branchId: 'branch-a', attachedFrom: '2026-10-01', attachedTo: null },
  ];

  await new ProjectServiceLines(scope, clock, ids, corrections, noCommissionBlockNotices).execute(input([line()]));

  expect(scope.lockInputs).toHaveLength(1);
  expect(corrections.drafts).toHaveLength(1);
  expect(corrections.drafts[0]).toMatchObject({
    employeeId: 'employee-a',
    sourcePeriod: '2026-10',
    targetPeriod: '2026-11',
    targetStatementId: 'statement-nov',
    sourceRef: 'line:line-a',
    amount: 1_000n,
    generation: 1,
    eventId: 'event-a',
    attribution: {
      sourceBranchId: 'branch-a',
      sourceBusinessDate: '2026-10-01',
      attachedBranchIds: ['branch-a'],
    },
  });
  expect(scope.calls).toEqual([
    'lockLines',
    'readHeads',
    'businessTimeZone',
    'lockPeriods',
    'readLinePerformers',
    'replaceLines',
    'bumpGeneration',
    'readMonthProjection',
    'readOpenBlock',
    'readFrozenSources',
    'readPostedCorrections',
    'readAttachmentSnapshot',
    'insertCorrections',
    'reopenReviewed',
  ]);
});

it('chooses the target before reopening a REVIEWED affected month', async () => {
  const scope = new FakeScope();
  scope.heads = [{ ...line({ revision: 1 }), period: '2026-10' }];
  scope.performers = [{ lineId: 'line-a', employeeId: 'employee-a', period: '2026-10' }];
  scope.locked = [
    { period: '2026-10', statementId: 'statement-oct', status: 'APPROVED' },
    { period: '2026-11', statementId: 'statement-nov', status: 'REVIEWED' },
    { period: '2026-12', statementId: 'statement-dec', status: 'DRAFT' },
  ];
  const corrections = new FakeCorrections(scope.calls);
  corrections.projection = monthProjection({ lines: [] });
  corrections.frozen = [
    {
      sourceRef: 'line:line-a',
      kind: 'COMMISSION',
      amount: 1_000n,
      attribution: {
        sourceBranchId: 'branch-a',
        sourceBusinessDate: '2026-10-01',
        attachedBranchIds: ['branch-a'],
      },
    },
  ];

  await new ProjectServiceLines(scope, clock, ids, corrections, noCommissionBlockNotices).execute(
    input([line({ businessDate: '2026-11-02' })]),
  );

  expect(corrections.drafts[0]).toMatchObject({
    targetPeriod: '2026-12',
    previousAmount: 1_000n,
    newAmount: 0n,
    amount: -1_000n,
  });
  expect(scope.reopenInput?.periods).toEqual(['2026-11']);
  expect(scope.calls.indexOf('insertCorrections')).toBeLessThan(
    scope.calls.indexOf('reopenReviewed'),
  );
});

it('rolls over after the lock wait without any projection or correction write', async () => {
  const scope = new FakeScope();
  scope.heads = [{ ...line({ revision: 1 }), period: '2026-10' }];
  const corrections = new FakeCorrections(scope.calls);
  const rollingClock = {
    now: () =>
      new Date(scope.lockInputs.length === 0 ? '2026-12-31T20:59:00Z' : '2027-01-01T00:00:00Z'),
  };

  const work = new ProjectServiceLines(scope, rollingClock, ids, corrections, noCommissionBlockNotices).execute(
    input([line()]),
  );

  await expect(work).rejects.toMatchObject({
    code: 'COMMISSION_PERIOD_ROLLED_OVER',
    plannedPeriod: '2026-12',
    currentPeriod: '2027-01',
  });
  expect(scope.replacements).toEqual([]);
  expect(scope.reopenInput).toBeUndefined();
  expect(corrections.drafts).toEqual([]);
  expect(scope.calls).toEqual(['lockLines', 'readHeads', 'businessTimeZone', 'lockPeriods']);
});

it('records a blocked correction when recomputation returns NO_PLAN', async () => {
  const scope = new FakeScope();
  scope.heads = [{ ...line({ revision: 1 }), period: '2026-10' }];
  scope.performers = [{ lineId: 'line-a', employeeId: 'employee-a', period: '2026-10' }];
  scope.locked = [
    { period: '2026-10', statementId: 'statement-oct', status: 'APPROVED' },
    { period: '2026-11', statementId: 'statement-nov', status: 'DRAFT' },
    { period: '2026-12', statementId: 'statement-dec', status: 'DRAFT' },
  ];
  const corrections = new FakeCorrections(scope.calls);
  corrections.projection = monthProjection({ versions: [] });

  await new ProjectServiceLines(scope, clock, ids, corrections, noCommissionBlockNotices).execute(input([line()]));

  expect(corrections.drafts).toEqual([]);
  expect(corrections.insertedBlocks).toEqual([
    {
      businessId: 'business-a',
      employeeId: 'employee-a',
      sourcePeriod: '2026-10',
      code: 'NO_PLAN',
      firstEventId: 'event-a',
      targetPeriod: '2026-11',
      targetStatementId: 'statement-nov',
    },
  ]);
  expect(corrections.codeUpdates).toEqual([]);
  expect(corrections.resolutions).toEqual([]);
  expect(scope.reopenInput?.periods).toEqual([]);
  expect(scope.calls).toEqual([
    'lockLines',
    'readHeads',
    'businessTimeZone',
    'lockPeriods',
    'readLinePerformers',
    'replaceLines',
    'bumpGeneration',
    'readMonthProjection',
    'readOpenBlock',
    'insertBlock',
    'reopenReviewed',
  ]);
});
