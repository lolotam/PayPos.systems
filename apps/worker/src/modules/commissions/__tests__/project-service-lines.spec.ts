import { expect, it } from 'vitest';

import type {
  CommissionLineEventInput,
  CommissionLineSnapshot,
  HeldCommissionLineHead,
  LockedCommissionPeriod,
} from '../domain/commission-line-types.ts';
import { CommissionPeriodClosedError } from '../domain/errors.ts';
import type {
  CommissionLineProjectionScope,
  CommissionLineReplacement,
  CommissionPeriodLockInput,
  CommissionPeriodReopenInput,
} from '../ports/commission-line-projection.port.ts';
import { ProjectServiceLines } from '../use-cases/project-service-lines/project-service-lines.ts';

function line(overrides: Partial<CommissionLineSnapshot> = {}): CommissionLineSnapshot {
  return {
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
    ruleSnapshot: { kind: 'ZERO' },
    countsSnapshot: true,
    revision: 2,
    ...overrides,
  };
}

const input = (lines: readonly CommissionLineSnapshot[]): CommissionLineEventInput => ({
  companyId: 'company-a',
  businessId: 'business-a',
  sessionId: 'session-a',
  lines,
});

class FakeScope implements CommissionLineProjectionScope {
  readonly calls: string[] = [];
  readonly replacements: CommissionLineReplacement[] = [];
  heads: readonly HeldCommissionLineHead[] = [];
  locked: readonly LockedCommissionPeriod[] = [];
  lockInput: CommissionPeriodLockInput | undefined;
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
    this.lockInput = input;
    return this.locked;
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

const clock = { now: () => new Date('2026-12-05T09:00:00Z') };
const ids = { newId: () => '01920000-0000-7000-8000-00000000ffff' };

it('runs locks, head read, one period lock, replacement and affected-only reopen in order', async () => {
  const scope = new FakeScope();
  scope.heads = [{ ...line({ revision: 1 }), period: '2026-10' }];
  scope.locked = [
    { period: '2026-10', statementId: 'statement-2026-10', status: 'REVIEWED' },
    { period: '2026-11', statementId: 'statement-2026-11', status: 'REVIEWED' },
    { period: '2026-12', statementId: 'statement-2026-12', status: 'DRAFT' },
  ];
  await new ProjectServiceLines(scope, clock, ids).execute(input([line()]));
  expect(scope.calls).toEqual([
    'lockLines',
    'readHeads',
    'businessTimeZone',
    'lockPeriods',
    'replaceLines',
    'reopenReviewed',
  ]);
  expect(scope.lockInput?.periods).toEqual(['2026-10', '2026-11', '2026-12']);
  expect(scope.reopenInput?.periods).toEqual(['2026-10']);
  expect(scope.replacements).toHaveLength(1);
});

it.each([1, 2])(
  'revision %i not newer than the head skips periods and every write',
  async (revision) => {
    const scope = new FakeScope();
    scope.heads = [{ ...line({ revision: 2 }), period: '2026-10' }];
    await new ProjectServiceLines(scope, clock, ids).execute(input([line({ revision })]));
    expect(scope.calls).toEqual(['lockLines', 'readHeads']);
    expect(scope.replacements).toEqual([]);
    expect(scope.reopenInput).toBeUndefined();
  },
);

it.each(['APPROVED', 'PAID'] as const)(
  'a closed affected month (%s) throws before replacement and reopen',
  async (status) => {
    const scope = new FakeScope();
    scope.heads = [{ ...line({ revision: 1 }), period: '2026-10' }];
    scope.locked = [{ period: '2026-10', statementId: 'statement-2026-10', status }];
    const work = new ProjectServiceLines(scope, clock, ids).execute(input([line()]));
    await expect(work).rejects.toBeInstanceOf(CommissionPeriodClosedError);
    await expect(work).rejects.toMatchObject({
      code: 'COMMISSION_PERIOD_CLOSED',
      periods: ['2026-10'],
    });
    expect(scope.calls).toEqual(['lockLines', 'readHeads', 'businessTimeZone', 'lockPeriods']);
    expect(scope.replacements).toEqual([]);
    expect(scope.reopenInput).toBeUndefined();
  },
);

it('a business-date change locks removal and addition months through the current month', async () => {
  const scope = new FakeScope();
  scope.heads = [{ ...line({ revision: 1, businessDate: '2026-09-01' }), period: '2026-09' }];
  scope.locked = [
    { period: '2026-09', statementId: 'statement-2026-09', status: 'REVIEWED' },
    { period: '2026-10', statementId: 'statement-2026-10', status: 'REVIEWED' },
    { period: '2026-11', statementId: 'statement-2026-11', status: 'REVIEWED' },
  ];
  await new ProjectServiceLines(scope, clock, ids).execute(
    input([line({ businessDate: '2026-10-15' })]),
  );
  expect(scope.lockInput?.periods).toEqual(['2026-09', '2026-10', '2026-11', '2026-12']);
  expect(scope.reopenInput?.periods).toEqual(['2026-09', '2026-10']);
  expect(scope.replacements[0]?.head.period).toBe('2026-10');
});
